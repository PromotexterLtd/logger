(function() {
	"use strict";

	var Logger = require('../logger');
	var Log = new Logger('myapp');
	Log.appname = 'myapp';

	Log.profile('request');
	// Log.raw("this is raw", "this is raw", "slkfj");
	// Log.debug("this is a debug", "this is raw", "slkfj");
	Log.info('hello world', 'x', 'y', [1,2,3]);
	Log.warn('hello world', 'x', 'y', [1,2,3]);
	// Log.error('this is an error');
	// Log.critical("this is critical", "this is raw", "slkfj");
    //
	Log.profile('request', "request duration");
	Log.info("this is another info", 2, 3, 4, 5);
	// Log.stats( {a: 'b', c: 'd'});

    Log.error('this is an error');
    Log.critical('this is critical');

	for(var i=0; i<5; i++) {
		Log.info('hello loggly');
	}


})();
