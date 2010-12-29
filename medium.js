var xmpp = require('./lib/xmpp');
var ircd = require('./lib/ircd');
var config = require('./config.js');

var jabberInfo = {
  host: 'jabber.org',
  jid: 'jabber.org',
  muc: 'conference.jabber.org'
};

var ircInfo = {
  created: new Date,
  name: 'medium',
  version: 'v0.1',
  host: 'localhost',
  port: 6667
};