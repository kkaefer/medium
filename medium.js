var xmpp = require('./lib/xmpp');
var ircd = require('./lib/ircd');
var helper = require('./lib/helper');
var config = require('./config.js');

require('./lib/color');

var find = helper.xmlFind;
var path = helper.xmlPath;
var xml = helper.xml;

var connections = [];

process.on('SIGINT', function() {
  if (!connections.length) process.exit();
  else {
    connections.forEach(function(kill) {
      kill();
    });
    connections = [];
  }
});

ircd.createServer(config.irc, function (irc) {
  var jabber = new xmpp.Connection(config.xmpp);
  
  // Rooms management.
  var rooms = {};
  function room(name) {
    if (!(name in rooms)) rooms[name] = new Room(irc, jabber, name);
    return rooms[name];
  }
  
  connections.push(function() {
    console.log('got sigint');
    for (var name in rooms) rooms[name].destroy();
    jabber.end();
    irc.end();
    console.log(RED('KILLED ALL CLIENTS'));
    delete jabber;
    delete irc;
  });
  

  // ===========================================================================
  // == Connection setup =======================================================

  irc.on('login', function fn() {
    if (!jabber.secure) return jabber.on('secure', fn.bind(this));

    if (!jabber.authMechanisms['PLAIN']) {
      jabber.emit('error', 'Server does not support authentication mechanism PLAIN.');
    }
    else {
      jabber.authenticate(irc.user);
      jabber.on('authenticated', jabber.bind);
      jabber.on('bind', jabber.startSession);
    }
  });


  // ===========================================================================
  // == IRC to Jabber ==========================================================

  irc.on('pong', function fn(line) {
    if (!jabber.session) return jabber.on('session', fn.bind(this, line));

    console.log('got pong command: ' + line);
  });

  irc.on('list', function fn(line) {
    if (!jabber.session) return jabber.on('session', fn.bind(this, line));

    console.log('got list command: ' + line);
  });

  irc.on('join', function fn(channel) {
    if (!jabber.session) return jabber.on('session', fn.bind(this, channel));
    room(channel.substring(1)).jabberJoin();
  });
  
  irc.on('part', function fn(channel) {
    if (!jabber.session) return jabber.on('session', fn.bind(this, channel));
    room(channel.substring(1)).jabberLeave();
  });

  irc.on('mode', function fn(mode) {
    if (!jabber.session) return jabber.on('session', fn.bind(this, mode));

    console.log('got mode command: ' + mode);
  });

  irc.on('privmsg', function fn(recipient, message) {
    if (!jabber.session) return jabber.on('session', fn.bind(this, recipient, message));

    if (recipient[0] === '#') {
      room(recipient.substring(1)).jabberMessage(message);
    }
    else {
      console.log(RED('PRIVMSG to users not yet implemented'));
      console.log('got privmsg command: ' + recipient + ' message: ' + message);
    }
  });

  irc.on('nick', function fn(nick) {
    if (!jabber.session) return jabber.on('session', fn.bind(this, recipient, message));

    // Broadcast nick change to all rooms.
    for (var name in rooms) {
      rooms[name].jabberNick(nick);
    }
  });

  // ===========================================================================
  // == Jabber to IRC ==========================================================

  // Handle ping message to maintain connection.
  jabber.on('iq', function(iq) {
    for (var i = 0, type; i < iq.length; i++) switch (iq[i].$name) {
      case 'ping':
        var stanza = xml.iq({ from: iq.to, to: iq.from, id: iq.id, type: 'result' });
        jabber.send(stanza);
        break;
    }
  });

  jabber.on('presence', function(presence) {
    var jid = new xmpp.JID(presence.from);
    if (jid.host === jabber.config.muc) {
      // This is a presence notification for a MUC room.
      room(jid.user).presence(jid, presence);
    }
  });

  jabber.on('message', function(message) {
    var jid = new xmpp.JID(message.from);

    if (message.type === 'groupchat' && jid.host === jabber.config.muc) {
      var body = path(message, 'message.body').$body;

      if (body) {
        // This is a PRIVMSG
        var delay = path(message, 'message.delay');
        if (delay && delay.stamp) body = '[' + delay.stamp + '] ' + body;
        var sender = ircd.sanitizeNick(jid.resource);
        room(jid.user).ircMessage(sender, body);
      }
      else {
        // This may be a topic change?
        console.log(RED('OTHER MESSAGES NOT IMPLEMENTED'));
      }

    }
    else {
      console.log(RED('MESSAGE TYPE NOT IMPLEMENTED: ' + message.type));
    }
  });
});

function Room(irc, jabber, name) {
  this.irc = irc;
  this.jabber = jabber;
  this.name = name;
  this.members = {};
}

Room.prototype = {
  get JID() {
    return this.name + '@' + config.xmpp.muc;
  },

  get nickJID() {
    return this.name + '@' + config.xmpp.muc + '/' + this.irc.user.nick;
  },

  get ircType() {
    return '='; // public
  },

  present: false,
  jabberJoin: function() {
    var room = this;

    room.present = false;
    room.jabber.roomPresence(room.nickJID, function(presence) {
      room.jabber.emit('presence', presence);
      // When join a room, the presence of the current user is announced last.
      // That means, when we encounter a presence notification for ourselves, we
      // know that the initial list of items is complete for this room and we can
      // continue with the joining process.
      room.present = true;
    
      // Continue with the joining process; the user's presence is now signalled
      // to jabber and the complete list of users should be stored in this object.
      // We can now send the join message to IRC.
      room.irc.command('JOIN', '#' + room.name);
      room.ircNames();
    });

    return this;
  },

  ircNames: function() {
    var nicks = [];
    var nickJID = this.nickJID;
    for (var jid in this.members) {
      // Don't include yourself in the NAMES listing.
      if (jid !== nickJID) nicks.push(ircd.sanitizeNick(this.members[jid].nick));
    }

    this.irc.reply('353', this.ircType + ' #' + this.name + ' :' + nicks.join(' '));
    this.irc.reply('366', ':End of /NAMES list.');
  },

  ircMessage: function(sender, body) {
    this.irc.command('PRIVMSG', '#' + this.name + ' :' + body, sender);
  },
  
  ircJoin: function(jid) {
    var nick = ircd.sanitizeNick(jid.resource) + '!' + ircd.sanitizeUser(jid.resource);
    this.irc.command('JOIN', '#' + this.name, nick);
  },
  
  ircPart: function(jid) {
    var nick = ircd.sanitizeNick(jid.resource);
    this.irc.command('PART', '#' + this.name, nick);
  },

  jabberMessage: function(body) {
    this.jabber.roomMessage(this.JID, body, function() {
      // Catch the reply so that it doesn't go into general dispatching
      // When we send a message to the jabber server, it replies with the same
      // message, but we don't want it to appear twice.
    });
  },

  jabberNick: function(nick) {
    this.jabber.roomNick(this.nickJID);
  },

  presence: function(jid, presence) {
    var id = presence.from;
    var existing = id in this.members;
    if (!existing) this.members[id] = {};
    var info = this.members[id];
    
    var item = path(presence, 'presence.x.item');
    info.role = item.role || '';
    info.affiliation = item.affiliation || '';
    info.nick = jid.resource;

    // <presence from='foo@conference.localhost/othernick' to='irc2muc@localhost/16168164881294954282749820' type='unavailable'><x xmlns='http://jabber.org/protocol/muc#user'><item affiliation='none' role='participant' nick='bar'/><status code='303'/></x></presence>
    

    if (this.present) {
      // User already joined. This is a notification for a new user.
      
      if (presence.type === 'unavailable') {
        this.ircPart(jid);
        delete this.members[id];
      }
      else if (!existing) {
        this.ircJoin(jid);
      }
      else {
        console.log(RED('UNKNOWN PRESENCE OF USER'));
      }
    }
  },

  jabberLeave: function() {
    this.jabber.leaveRoom(this.JID);
  },

  destroy: function() {
    this.jabberLeave();
  }
};
