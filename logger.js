(function() {
	"use strict";

	var winston = require('winston');
	var os      = require('os');
	var MongoDB = require('winston-mongodb').MongoDB;
	var SNS     = require('winston-sns');
	var http    = require('http');
	var crypto  = require('crypto');
    var loggly  = require('loggly');

	var levels  = {
		default_logger: {
			levels: {
				raw      : 0,
				debug    : 1,
				info     : 2,
				warn     : 3,
				error    : 4,
				critical : 5
			},
			colors: {
				raw      : 'grey',
				debug    : 'inverse',
				info     : 'green',
				warn     : 'magenta',
				error    : 'red',
				critical : 'redBG',
			}
		},
		raw_logger: {
			levels: {
				raw : 0,
			},
			colors: {
				raw : 'grey',
			}
		}
	};

	//encapsulate winston logging
	var Logger = function() {

		var self      = this;
		var args      = Array.prototype.slice.call(arguments);
		self.hostname = os.hostname();
		self.appname  = (args.length > 0) ? args[0] : null;


		self.default_logger = new (winston.Logger)({level: 'raw',
								levels: levels.default_logger.levels,
								colors: levels.default_logger.colors});
		self.raw_logger     = new (winston.Logger)({level: 'raw',
								levels: levels.raw_logger.levels,
								colors: levels.raw_logger.colors});
		self.sns_logger = new (winston.Logger)({level: 'raw',
								levels: levels.default_logger.levels,
								colors: levels.default_logger.colors});

		//options
		var conf = require('rc')('logger', {});
		self.conf = conf;

		self.default_logger.add(winston.transports.Console, {'timestamp':true, 'colorize': true, 'level':'raw'});

		if(typeof conf.file === 'object') {
			conf.file.filename = (self.appname === null)? conf.file.filename : conf.file.filename +'-'+ self.appname.toLowerCase();
			self.default_logger.add(winston.transports.DailyRotateFile, conf.file);
			conf.file.filename += '-raw';
			self.raw_logger.add(winston.transports.DailyRotateFile, conf.file);
		}

		if(typeof conf.mongodb === 'object') {
			self.default_logger.add(MongoDB, conf.mongodb);
		}

		if(typeof conf.sns === 'object') {
			self.sns_logger.add(SNS, conf.sns);
		}

        if(typeof conf.loggly === 'object') {
            //console.log(conf.loggly);
            self.loggly = loggly.createClient({
                subdomain : conf.loggly.subdomain,
                auth      : conf.loggly.auth || null,
                json      : conf.loggly.json || false,
                proxy     : conf.loggly.proxy || null,
                token     : conf.loggly.inputToken,
                //tags      : tags,
                //isBulk    : conf.loggly.isBulk || false
            });

            self.logglylogs = [];
        }

		// winston supports string interpolation. We don't need that
		// we just want to concat args

		var sns_sent = {};
		self.log = function(level, message) {

			level    = level.toLowerCase();
			var meta = {};
			var more = Array.prototype.slice.call(arguments, 2);

			meta.appname = self.appname;
			meta.host    = self.hostname;

			if(more.length > 0) {
				for(var i in more) {
					message = message + " " + JSON.stringify(more[i]);
				}

			}

			if(level === 'raw') {
				self.raw_logger.raw(message, meta);
				self.default_logger[level.toLowerCase()](message, meta);
			} else {
				self.default_logger[level.toLowerCase()](message, meta);
			}

			if(level == 'error' || level == 'critical') {
				self.log('debug', level.toUpperCase() + ':' + new Error().stack);
			}

			// sns logging
			if(typeof conf.sns === 'object') {
				if(levels.default_logger.levels[level] >= levels.default_logger.levels[conf.sns.level]) {

					var hasher = crypto.createHash('md5');
					var hash   = hasher.update(level + message).digest('hex');
					var now    = Math.round(new Date().getTime() / 1000);

					//log every t_since secs for identical messages
					if(typeof sns_sent[hash] !== 'undefined') {
						if(now - sns_sent[hash].t_since > conf.sns.interval) {
							self.sns_logger[level.toLowerCase()](message, meta);
							sns_sent[hash].t_since = now;
						}
					} else {
						sns_sent[hash]         = {};
						sns_sent[hash].t_since = now;
						self.sns_logger[level.toLowerCase()](message, meta);
					}
				}
			}

            if(self.loggly) {
                meta.message = message;
                meta.level = level;
                self.logglylogs.push(meta);
            }


		};

        setInterval(function() {
            if(self.logglylogs && self.logglylogs.length > 0) {
                //console.log('draining loggly logs');
                self.loggly.log(self.logglylogs.splice(0, self.logglylogs.length), function(err, res) {
                    if(err) {
                        //console.log(err);
                    } else {
                        //console.log('sent logs to loggly', res);
                    }

                });
            }
        }, 1000);

		var methods = [
			'raw',
			'debug',
			'info',
			'warn',
			'error',
			'critical'
		].forEach(function(e) {
			self[e] = function() {
				var args = [e];
				args = args.concat(Array.prototype.slice.call(arguments));
				self.log.apply(this, args);
			};
		});

		self.profile = function(tag, msg) {
			var meta     = {};
			meta.appname = self.appname;
			meta.host    = self.hostname;

			if(typeof msg === 'undefined') {
				msg = tag;
			}
			self.default_logger.profile(tag, msg, meta, function() {
				//console.log(arguments);
			});
		};

		self.stats = function(obj) {
			if(typeof conf.magnesium !== 'object') {
				return;
			}
			conf = self.conf;
			var http_options = {
				method   : 'POST',
				hostname : conf.magnesium.host,
				path     : '/stats',
				port     : conf.magnesium.port

			};


			var body = {
				'api_key'    : conf.magnesium.api_key,
				'api_secret' : conf.magnesium.api_secret,
				'server'     : self.hostname,
				'stats'      : obj
			};


			http_options.headers =  {
				'Content-Type': 'application/json'
			};

			var req = http.request(http_options, function(res) {
				self.info('saved stats to magnesium', String(res));
			});

			req.on('error', function(e) {
				self.error("cannot send log stats", e);
			});


			req.write(JSON.stringify(body));
			req.end();
		};
	};

	module.exports = Logger;
})();
