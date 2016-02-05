/*
	MIT License http://www.opensource.org/licenses/mit-license.php
  Based on ContextReplacementPlugin by Tobias Koppers @sokra
*/
var path = require("path");
var fileSystem = require('fs');
var ContextElementDependency = require('webpack/lib/dependencies/ContextElementDependency');

function AureliaContextPlugin(options) {  
  options = options || {};
  options.root = options.root || path.dirname(module.parent.filename);
  options.src = options.src || path.resolve(options.root, 'src');
  options.resourceRegExp = options.resourceExp || /aurelia-loader-context/;
  
  this.options = options;
  
  if (this.options.contextMap) {
    this.createContextMap = function(fs, callback) {
      callback(null, this.options.contextMap);
    };
  } else {
    this.createContextMap = function(fs, callback) {
      var self = this;
      var contextMap = {};
          // No context map supplied, let's create a default map from all dependencies in package.json
      var pkg = JSON.parse(fileSystem.readFileSync(path.resolve(self.options.root, 'package.json')));
      var vendorPackages = Object.keys(pkg.dependencies).filter(function(el) {
        return el.indexOf('font') === -1; // exclude font packages from vendor bundle
      });
      vendorPackages.forEach(function(moduleId) {
        // We're storing the complete path to the package entry file in the context map. This is not
        // required directly, but we need it to resolve aurelia's submodules.
        var vendorPath = path.resolve(self.options.root, 'node_modules', moduleId);
        var vendorPkgPath = path.resolve(vendorPath, 'package.json');
        var vendorPkg = JSON.parse(fileSystem.readFileSync(vendorPkgPath, 'utf8'));
        contextMap[moduleId] = path.resolve(vendorPath, vendorPkg.browser || vendorPkg.main);
      });
      callback(null, contextMap);
    }.bind(this);
  }
}

module.exports = AureliaContextPlugin;

AureliaContextPlugin.prototype.apply = function(compiler) {
  var self = this;
  
	compiler.plugin("context-module-factory", function(cmf) {
		cmf.plugin("before-resolve", function(result, callback) {
			if (!result) return callback();
			if (self.options.resourceRegExp.test(result.request)) {
				if (typeof self.options.src !== "undefined") {
					result.request = self.options.src;
        }
			}
			return callback(null, result);
		});
    cmf.plugin("after-resolve", function(result, callback) {
			if (!result) return callback();
			if (self.options.src.endsWith(result.resource)) {
        result.resolveDependencies = createResolveDependenciesFromContextMap(self.createContextMap, result.resolveDependencies);
			}
			return callback(null, result);
		});
	});
};

function createResolveDependenciesFromContextMap(createContextMap, originalResolveDependencies) {
	return function resolveDependenciesFromContextMap(fs, resource, recursive, regExp, callback) {
    
    originalResolveDependencies(fs, resource, recursive, regExp, function (err, dependencies)  {
      if(err) return callback(err);
      
      createContextMap(fs, function(err, map) {
        if(err) return callback(err);
        
        Object.keys(map).forEach(function(key) {
          // Add main module as dependency
          dependencies.push(new ContextElementDependency(key, './' + key));
          // Also include all other modules as subdependencies when it is an aurelia module. This is required
          // because Aurelia submodules are not in the root of the NPM package and thus cannot be loaded 
          // directly like import 'aurelia-templating-resources/compose'
          if (key.startsWith('aurelia-')) {
            var mainDir = path.dirname(map[key]);
            var mainFileName = path.basename(map[key]);
            var files = fileSystem.readdirSync(mainDir);
            files.forEach(function(fileName) {
              if (fileName.indexOf(mainFileName) === -1 && fileName.match(/[^\.]\.(js||html|css)$/)) {
                var subModuleKey = key + '/' + path.basename(fileName, path.extname(fileName));
                dependencies.push(new ContextElementDependency(path.resolve(mainDir, fileName), './' + subModuleKey));
              } 
            });          
          }
        });
        
        callback(null, dependencies);
      });      
    });
	}.bind(this);
};