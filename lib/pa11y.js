'use strict';

var once = require('once');
var async = require('async');
var extend = require('node.extend');
var lowercase = require('lower-case');
var pkg = require('../package.json');
var truffler = require('truffler');
var trufflerPkg = require('truffler/package.json');
var phantomjsPath = require('phantomjs-prebuilt').path;
var path = require('path');

module.exports = pa11y;
module.exports.defaults = {
	beforeScript: null,
	hideElements: null,
	htmlcs: __dirname + '/vendor/HTMLCS.js',
	ignore: [],
	log: {
		begin: /* istanbul ignore next */ function() {},
		debug: /* istanbul ignore next */ function() {},
		error: /* istanbul ignore next */ function() {},
		info: /* istanbul ignore next */ function() {},
		results: /* istanbul ignore next */ function() {}
	},
	page: {
		settings: {
			userAgent: 'pa11y/' + pkg.version + ' (truffler/' + trufflerPkg.version + ')'
		}
	},
	phantom: {
		onStdout: /* istanbul ignore next */ function() {},
		parameters: {
			'ignore-ssl-errors': 'true'
		},
		path: phantomjsPath
	},
	rootElement: null,
	standard: 'WCAG2AA',
	allowedStandards: ['Section508', 'WCAG2A', 'WCAG2AA', 'WCAG2AAA'],
	wait: 0
};

function pa11y(url, options) {
	options = defaultOptions(options);
	if (options.allowedStandards.indexOf(options.standard) === -1) {
		throw new Error('Standard must be one of ' + options.allowedStandards.join(', '));
	}
	if (isRelativeFilePath(url)) {
		throw new Error('Local Url given as input must have absolute paths.')
	}
	return truffler(options, testPage);
}

function defaultOptions(options) {
	options = extend(true, {}, module.exports.defaults, options);
	options.ignore = options.ignore.map(lowercase);
	return options;
}

function isRelativeFilePath(url) {
	// 7 accounts for the length of 'file://'
	return url.startsWith('file:\/\/') && !path.isAbsolute(url.substring(7, url.length-7))
}


function testPage(browser, page, options, done) {

	page.onCallback = once(function(result) {
		if (result instanceof Error) {
			return done(result);
		}
		if (result.error) {
			return done(new Error(result.error));
		}
		options.log.debug('Document title: "' + result.documentTitle + '"');
		done(null, result.messages);
	});

	async.waterfall([

		// Run beforeScript
		function(next) {
			if (typeof options.beforeScript !== 'function') {
				return next();
			}

			options.log.debug('Running beforeScript');
			options.beforeScript(page, options, next);
		},

		// Inject HTML CodeSniffer
		function(next) {
			options.log.debug('Injecting HTML CodeSniffer');
			if (/^(https?|file):\/\//.test(options.htmlcs)) {
				// Include remote URL
				page.includeJs(options.htmlcs, function(error, included) {
					if (error) {
						return next(error);
					}
					if (!included) {
						return next(new Error('Pa11y was unable to include scripts in the page'));
					}
					next();
				});
			} else {
				// Inject local file
				page.injectJs(options.htmlcs, function(error, injected) {
					if (error) {
						return next(error);
					}
					if (!injected) {
						return next(new Error('Pa11y was unable to inject scripts into the page'));
					}
					next();
				});
			}
		},

		// Inject Pa11y
		function(next) {
			options.log.debug('Injecting Pa11y');
			page.injectJs(__dirname + '/inject.js', function(error, injected) {
				if (error) {
					return next(error);
				}
				if (!injected) {
					return next(new Error('Pa11y was unable to inject scripts into the page'));
				}

				next();
			});
		},

		// Run Pa11y on the page
		function(next) {
			options.log.debug('Running Pa11y on the page');
			if (options.wait > 0) {
				options.log.debug('Waiting for ' + options.wait + 'ms');
			}
			page.evaluate(function(options) {
				/* global injectPa11y: true, window: true */
				if (typeof window.callPhantom !== 'function') {
					return {
						error: 'Pa11y could not report back to PhantomJS'
					};
				}
				injectPa11y(window, options, window.callPhantom);
			}, {
				hideElements: options.hideElements,
				ignore: options.ignore,
				rootElement: options.rootElement,
				standard: options.standard,
				wait: options.wait
			}, next);
		}

	], function(error, result) {
		// catch any errors which occur in the injection process
		if (error) {
			page.onCallback(error);
		}
		if (result && result.error) {
			page.onCallback(result);
		}
	});
}
