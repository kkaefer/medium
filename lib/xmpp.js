var net = require('net');
var util = require('util');
var crypto = require('crypto');
var EventEmitter = require('events').EventEmitter;
var Buffer = require('buffer').Buffer;
var helper = require('./helper');

var find = helper.xmlFind;
var path = helper.xmlPath;
var xml = helper.xml;

function noop() {};

var ns = {
  'disco#info': 'http://jabber.org/protocol/disco#info',
  'disco#items': 'http://jabber.org/protocol/disco#items',
  'caps': 'http://jabber.org/protocol/caps',
  'muc#user': 'http://jabber.org/protocol/muc#user',
  'xmpp-tls': 'urn:ietf:params:xml:ns:xmpp-tls',
  'xmpp-sasl': 'urn:ietf:params:xml:ns:xmpp-sasl',
  'xmpp-bind': 'urn:ietf:params:xml:ns:xmpp-bind',
  'xmpp-session': 'urn:ietf:params:xml:ns:xmpp-sasl'
};


function JID(str) {
  var start = str.indexOf('@') + 1, end = str.lastIndexOf('/');
  this.user = start > 0 ? str.substring(0, start - 1) : '';
  this.resource = end > 0 ? str.substring(end + 1) : '';
  this.host = str.substring(start, end > 0 ? end : undefined);
}
exports.JID = JID;
JID.prototype.asJID = function() {
  var jid = this.host;
  if (this.user) jid = this.user + '@' + jid;
  if (this.resource) jid += '/' + this.resource;
  return jid;
};



function Connection(config) {
  this.config = config;

  this.config.port = config.port || 5222;

  this.setupStream();
  this.setupHandlers();

  this.requests = {};
  this.uniqueID = 1;
}
exports.Connection = Connection;
util.inherits(Connection, EventEmitter);

Connection.prototype.once = function(type, listener) {
  var self = this;
  self.on(type, function g() {
    self.removeListener(type, g);
    listener.apply(this, arguments);
  });
};

Connection.prototype.createParser = function() {
  var self = this;
  var xml = require('xml');
  this.parser = new xml.SaxParser(function(cb) {
    var tree = [ ];

    cb.onStartElementNS(function(elem, attrs, prefix, uri, namespaces) {
      var element = [];
      element.$name = elem;
      // element.$prefix = prefix;
      // element.$uri = uri;
      // element.$namespaces = namespaces;

      for (var i = 0; i < attrs.length; i++) {
        element[attrs[i][0]] = attrs[i][1];
      }

      if (!tree.length) {
        self.emit('stream', element);
      }
      else {
        tree[0].push(element);
      }
      tree.unshift(element);
    });

    cb.onCharacters(function(chars) {
      if (!('$body' in tree[0])) tree[0].$body = '';
      tree[0].$body += chars;
    });

    cb.onEndElementNS(function(elem, prefix, uri) {
      var element = tree.shift();
      if (tree.length === 1) {
        if (element.id && (element.id in self.requests)) {
          // If the response has an ID associated with it, call the corresponding
          // function supplied when placing the request.
          var command = self.requests[element.id];
          command.call(self, element);
        }
        else {
          self.emit(element.$name, element);
        }
      }
    });
  });
};

Connection.prototype.setupStream = function() {
  var self = this;

  this.stream = net.createConnection(this.config.port, this.config.host);
  this.stream.setEncoding('ascii');
  this.stream.on('error', function(err) { self.emit('error'); });
  this.stream.on('connect', function() { self.initStream(); });
  this.stream.on('secure', function() { self.initStream(); });
  this.stream.on('data', function(str) {
    console.log(BLUE('in  <- ' + str));
    self.parser.parseString(str);
  });
  this.stream.on('end', function() { self.emit('end'); });
  this.stream.on('close', function() { self.emit('close'); });
};

Connection.prototype.setupHandlers = function() {
  this.once('features', function(features) {
    if (find(features, 'starttls').length)
      this.startTLS();
    else {
      this.emit('error', 'Server does not support STARTTLS.');
      
      // DEBUG: Proceed anyway without SSL!
      this.detectFeatures(features);
    }
  });
};

Connection.prototype.initStream = function() {
  var self = this;

  this.createParser();
  this.once('stream', function(stream) {
    self.id = stream.id;
  });
  this.stream.write('<stream:stream ' +
    'xmlns="jabber:client" ' +
    'xmlns:stream="http://etherx.jabber.org/streams" ' +
    'to="' + this.config.jid + '" ' +
    'version="1.0">');
};

Connection.prototype.detectFeatures = function(features) {
  var auth = {};
  find(features, 'mechanisms').forEach(function(mechanisms) {
    find(mechanisms, 'mechanism').forEach(function(mechanism) {
      auth[mechanism.$body] = true;
    });
  });
  this.authMechanisms = auth;
  this.secure = true;
  this.emit('secure');
};

Connection.prototype.startTLS = function() {
  this.stream.write('<starttls xmlns="urn:ietf:params:xml:ns:xmpp-tls"/>');

  this.once('proceed', function() {
    this.stream.setSecure();
  });

  this.once('features', function(features) {
    this.detectFeatures(features);
  });
};

Connection.prototype.authenticate = function(user) {
  this.user = user;
  var plain = new Buffer('\0' + user.user + '\0' + user.password).toString('base64');
  this.stream.write('<auth xmlns="urn:ietf:params:xml:ns:xmpp-sasl" mechanism="PLAIN">' + plain + '</auth>');

  function success() {
    this.removeListener('failure', failure);
    this.initStream();
    this.emit('authenticated');
  }
  function failure(error) {
    console.log(error);
    this.emit('error', 'Failed to authenticate.');
    this.removeListener('success', success);
  }

  this.once('success', success);
  this.once('failure', failure);
};

Connection.prototype.end = function() {
  switch (this.stream.readyState) {
    case 'writeOnly': // The other party disconnected the stream already.
    case 'open':
    case 'opening':
      console.log(PURPLE('out -> ' + '</stream:stream>'));
      this.stream.end('</stream:stream>');
      break;
    case 'readOnly': // We already ended the stream.
    case 'closed': // The stream is already closed.
      // Nothing to do.
      break;
    
  }
};

Connection.prototype.request = function(stanza, callback) {
  var id = 'medium' + (this.uniqueID++);

  if (callback) this.requests[id] = callback;
  stanza.$attrs.id = id;
  stanza = xml.$render(stanza);
  console.log(PURPLE('out -> ' + stanza));
  this.stream.write(stanza);
};

Connection.prototype.send = function(stanza) {
  if (!stanza.$attrs.id) {
    stanza.$attrs.id = 'medium' + (this.uniqueID++);
  }
  stanza = xml.$render(stanza);
  console.log(PURPLE('out -> ' + stanza));
  this.stream.write(stanza);
};

Connection.prototype.bind = function() {
  this.request(
    xml.iq({ type: 'set' }, xml.bind({ xmlns: 'urn:ietf:params:xml:ns:xmpp-bind' })),
    function(response) {
      this.user = new JID(path(response, 'bind.jid').$body);
      this.emit('bind');
    }
  );
};

Connection.prototype.startSession = function() {
  this.request(
    xml.iq({ type: 'set' }, xml.session({ xmlns: 'urn:ietf:params:xml:ns:xmpp-session' })),
    function(response) {
      this.session = true;
      this.emit('session');
    }
  );
};




Connection.prototype.roomInfo = function(roomJID, callback) {
  var query = xml.query({ xmlns: 'http://jabber.org/protocol/disco#info' });
  var stanza = xml.iq({ type: 'get', to: roomJID }, query);
  this.request(stanza, callback);
};

Connection.prototype.roomItems = function(roomJID, callback) {
  var query = xml.query({ xmlns: 'http://jabber.org/protocol/disco#items' });
  var stanza = xml.iq({ type: 'get', to: roomJID }, query);
  this.request(stanza, callback);
};

Connection.prototype.roomPresence = function(nickJID, callback) {
  var capability = xml.x({ xmlns: 'http://jabber.org/protocol/muc' });
  var stanza = xml.presence({ to: nickJID }, capability);
  this.request(stanza, callback);
};

Connection.prototype.roomMessage = function(roomJID, message, callback) {
  var body = xml.body(null, message);
  var stanza = xml.message({ to: roomJID, type: 'groupchat' }, body);
  this.request(stanza, callback);
};

Connection.prototype.roomNick = function(nickJID, callback) {
  var stanza = xml.presence({ to: nickJID });
  this.request(stanza, callback);
};

Connection.prototype.leaveRoom = function(roomJID) {
  var stanza = xml.presence({ to: roomJID, type: 'unavailable' });
  this.request(stanza);
};

Connection.prototype.userMessage = function(userJID, message, callback) {
  var body = xml.body(null, message);
  var stanza = xml.message({ to: userJID, type: 'chat' }, body);
  this.request(stanza, callback);
};
