var net = require('net');
var util = require('util');
var crypto = require('crypto');
var EventEmitter = require('events').EventEmitter;
var dns = require('dns');
var fs = require('fs');

// Load the credentials (self-signed) for the server.
var caPem = fs.readFileSync(__dirname + '/../support/test_ca.pem', 'ascii');
var certPem = fs.readFileSync(__dirname + '/../support/test_cert.pem', 'ascii');
var keyPem = fs.readFileSync(__dirname + '/../support/test_key.pem', 'ascii');
var credentials = crypto.createCredentials({ key: keyPem, cert: certPem, ca: caPem });


exports.createServer = function(config, callback) {
  return net.createServer(function (stream) {
    callback(new Connection(stream, config));
  }).listen(config.port || 6667, undefined, function(info) {
    console.log('IRC daemon listening on port ' + (config.port || 6667) + '...');
  });
};






function Connection(stream, config) {
  this.stream = stream;
  this.config = config;

  this.user = {
    host: this.stream.remoteAddress
  };

  this.setup();
}
util.inherits(Connection, EventEmitter);
exports.Connection = Connection;

Connection.prototype.setup = function() {
  this.stream.setSecure(credentials);
  this.stream.setEncoding('ascii');

  // Dechunk the incoming data and call the according handler functions.
  var connection = this;
  var previous = '';
  this.stream.on('data', function(str) {
    var lines = str.split('\r\n');
    lines[0] = previous + lines[0];
    previous = lines.pop();
    for (var i = 0; i < lines.length; i++) {
      var cmd = lines[i].split(' ', 1)[0];
      if (config.debug) console.log(BROWN('IRC in<< ' + lines[i]));
      if (cmd in connection) {
        connection[cmd](lines[i].substring(cmd.length + 1));
      }
      else {
        if (config.debug) console.log('IRC COMMAND NOT HANDLED');
      }
    }
  });
  
  this.stream.on('end', function() { connection.emit('end'); });
  this.stream.on('close', function() { connection.emit('close'); });
};

Connection.prototype.end = function() {
  switch (this.stream.readyState) {
    case 'writeOnly': // The other party disconnected the stream already.
    case 'open':
    case 'opening':
      this.stream.end();
      break;
    case 'readOnly': // We already ended the stream.
    case 'closed': // The stream is already closed.
      // Nothing to do.
      break;
  }
};

Connection.prototype.PASS = function(pass) {
  this.user.password = pass;
};

Connection.prototype.NICK = function(nick) {
  this.user.nick = nick;
  if (this.user.user) {
    // Nick change.
    this.emit('nick', nick);
  }
};

Connection.prototype.USER = function(line) {
  var parts = line.split(/\s+/g, 3);
  this.user.user = parts[0];
  this.user.mode = parseInt(parts[1], 10);
  this.user.realname = line.substring(parts[0].length + parts[1].length + parts[2].length + 3);

  this.reply('001', ':Welcome to the Jabber MUC Relay Network, ' + this.user.nick);
  this.reply('002', ':Your host is ' + this.config.host + ', running version ' + this.config.name + ' ' + this.config.version);
  this.reply('003', ':This server was created ' + this.config.created);
  this.reply('004', this.config.host + ' ' + this.config.name + '-' + this.config.version + ' ');

  this.loggedIn = true;
  this.emit('login');
};

Connection.prototype.LIST = function(line) {
  this.emit('list', line);
};

Connection.prototype.JOIN = function(line) {
  // Discard optional password.
  var channel = line.split(' ', 1)[0];
  var rest = line.substring(channel.length + 1);
  
  var channels = channel.split(',');
  for (var i = 0; i < channels.length; i++) {
    this.emit('join', channels[i], rest);
  }
};

Connection.prototype.MODE = function(line) {
  var recipient = line.split(' ', 1)[0];
  var rest = line.substring(recipient.length + 1);
  this.emit('mode', recipient, rest);
};

Connection.prototype.PRIVMSG = function(line) {
  var recipient = line.split(' ', 1)[0];
  var message = line.substring(recipient.length + 1);
  if (message[0] === ':') message = message.substring(1);
  this.emit('privmsg', recipient, message);
};

Connection.prototype.PART = function(line) {
  var channel = line.split(' ', 1)[0];
  this.emit('part', channel);
};

Connection.prototype.PONG = function(line) {
  this.emit('pong', line);
};

Connection.prototype.QUIT = function(line) {
  this.emit('quit', line);
};

Connection.prototype.reply = function(code, msg) {
  var str = ':' + this.config.name + ' ' + code + ' ' + this.user.nick + ' ' + msg + '\r\n';
  if (config.debug) console.log(GREEN('IRC out>> ' + util.inspect(str)));
  this.stream.write(str);
};

Connection.prototype.error = function(msg) {
  var str = 'ERROR :' + msg + '\r\n';
  if (config.debug) console.log(GREEN('IRC out>> ' + util.inspect(str)));
  this.stream.write(str);
};

Connection.prototype.command = function(cmd, msg, user) {
  var str = ':' + (user || (this.user.nick + '!' + this.user.user)) + ' ' + cmd + ' ' + msg + '\r\n';
  if (config.debug) console.log(GREEN('IRC out>> ' + util.inspect(str)));
  this.stream.write(str);
};



exports.sanitizeNick = function(str) {
  // This is how it should be according to RFC:
  // return str.replace(/([^\x30-\x7D-]|@)+/g, '_');

  // Most clients support UTF-8, however, so we just strip control characters.
  // We replace spaces with a non-breaking space because they really aren't allowed.
  return str.replace(/ /g, '\u00A0').replace(/[\x00-\x2F@]+/g, '_');
};

exports.sanitizeUser = function(str) {
  return str.replace(/[\0\r\n @]+/g, '_');
};

exports.sanitizeMessage = function(str) {
  return str.replace(/\r?\n/g, ' ');
};


