var xmpp = require('./lib/xmpp');
var ircd = require('./lib/ircd');
var helper = require('./lib/helper');
var config = global.config = require('./config.js');

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

  jabber.on('error', function fn() {
    if (!irc.loggedIn) return irc.on('login', fn.bind(this));

    irc.error('Could not connect to Jabber server.');
    process.nextTick(function() { irc.end(); });
  });


  // Rooms management.
  var rooms = {};
  function room(name) {
    if (!(name in rooms)) rooms[name] = new Room(irc, jabber, name);
    return rooms[name];
  }

  connections.push(function() {
    for (var name in rooms) rooms[name].destroy();
    jabber.end();
    irc.end();
    console.log(RED('Killed all clients.'));
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

    if (config.debug) console.log('got pong command: ' + line);
  });

  irc.on('list', function fn(line) {
    if (!jabber.session) return jabber.on('session', fn.bind(this, line));

    if (config.debug) console.log('got list command: ' + line);
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

    if (config.debug) console.log('got mode command: ' + mode);
  });

  irc.on('privmsg', function fn(recipient, message) {
    if (!jabber.session) return jabber.on('session', fn.bind(this, recipient, message));

    if (recipient[0] === '#') {
      room(recipient.substring(1)).jabberRoomMessage(message);
    }
    else {
      for (var name in rooms) {
        for (var jid in rooms[name].members) {
          if (rooms[name].members[jid].ircNick === recipient) {
            jabber.userMessage(jid, message);
            return;
          }
        }
      }

      if (config.debug) console.log(RED('USER DOES NOT EXIST'));
      if (config.debug) console.log('got privmsg command: ' + recipient + ' message: ' + message);
    }
  });

  irc.on('nick', function fn(nick) {
    if (!jabber.session) return jabber.on('session', fn.bind(this, nick));

    // Broadcast nick change to all rooms.
    for (var name in rooms) {
      rooms[name].jabberNick(nick);
    }
  });

  irc.on('quit', function fn(line) {
    if (!jabber.session) return jabber.on('session', fn.bind(this, line));

    if (!irc.quit && !jabber.quit) {
      irc.quit = true;
      // Leave all rooms.
      for (var name in rooms) {
        rooms[name].jabberLeave();
      }
      jabber.end();
    }
  });

  irc.on('end', function fn() {
    if (!jabber.session) return jabber.on('session', fn.bind(this));

    // The user disconnected or the connection was lost. Treat this as if the
    // user send a QUIT command.
    irc.emit('quit');
  });

  irc.on('close', function fn() {
    if (!jabber.session) return jabber.on('session', fn.bind(this));

    // The connection is completely closed in both read and write direction.
    irc.closed = true;
    cleanup();
  });

  function cleanup() {
    if (irc.closed && jabber.closed) {
      delete jabber;
      delete irc;
    }
  }

  // ===========================================================================
  // == Jabber to IRC ==========================================================

  jabber.on('end', function() {
    // The Jabber server ended the connection or the connection was lost.
    jabber.quit = true;
    if (!irc.quit) {
      // Disconnect the IRC client, but send a notice that the Jabber connection ended.
      irc.error('The Jabber server disconnected.');
      irc.end();
    }
  });

  jabber.on('close', function() {
    // The connection is completely closed in both read and write direction.
    jabber.closed = true;
    cleanup();
  });

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

    var delay = path(message, 'delay');
    var x = path(message, 'x');
    // Normalize timestamp so that we can parse it with new Date();
    if (x && x.stamp) delay = x.stamp.replace(/^(\d\d\d\d)(\d\d)(\d\d)T(\d\d:\d\d:\d\d)$/, '$1-$2-$3T$4Z');
    else if (delay && delay.stamp) delay = delay.stamp;


    if (message.type === 'groupchat' && jid.host === jabber.config.muc) {
      var obj;
      if (obj = path(message, 'subject')) {
        // This is a topic change.
        room(jid.user).ircTopic(jid, obj.$body, delay);
      }
      else if (obj = path(message, 'body')) {
        // This is a regular message to the channel.
        var body = ircd.sanitizeMessage(obj.$body);
        if (delay) body = '\x0315[' + delay + ']\x03 ' + body;
        var sender = ircd.sanitizeNick(jid.resource);
        room(jid.user).ircMessage(sender, body);
      }
      else {
        if (config.debug) console.log(RED('OTHER MESSAGES NOT IMPLEMENTED'));
      }

    }
    else if (message.type === 'chat' && jid.host === jabber.config.muc) {
      var obj;
      if (obj = path(message, 'body')) {
        var body = ircd.sanitizeMessage(obj.$body);
        var sender = ircd.sanitizeNick(jid.resource);
        irc.command('PRIVMSG', irc.user.nick + ' :' + body, sender);
      }
      else {
        // This is for example a composing message that we can't replicate in IRC.
      }
    }
    else {
      if (config.debug) console.log(RED('MESSAGE TYPE NOT IMPLEMENTED: ' + message.type));
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

  topic: undefined,

  joined: false,

  jabberJoin: function() {
    this.joined = false;
    this.jabber.roomPresence(this.nickJID);
    return this;
  },

  ircNames: function() {
    var nicks = [];
    var nickJID = this.nickJID;
    for (var jid in this.members) {
      var nick = this.members[jid].ircNick;
      if (this.members[jid].role === 'moderator') nick = '@' + nick;
      nicks.push(nick);
    }

    this.irc.reply('353', this.ircType + ' #' + this.name + ' :' + nicks.join(' '));
    this.irc.reply('366', ':End of /NAMES list.');
  },

  ircMessage: function(sender, body) {
    this.irc.command('PRIVMSG', '#' + this.name + ' :' + body, sender);
  },

  ircJoin: function(jid, info) {
    var nick = ircd.sanitizeNick(jid.resource) + '!';
    if (info.realJID) nick += info.realJID;
    else nick += ircd.sanitizeUser(jid.user) + '@' + ircd.sanitizeUser(jid.host + '/' + jid.resource);

    this.irc.command('JOIN', '#' + this.name, nick);
  },

  ircPart: function(jid) {
    var nick = ircd.sanitizeNick(jid.resource);
    this.irc.command('PART', '#' + this.name + ' Leaving...', nick);
  },

  ircNick: function(jid, newNick) {
    var nick = ircd.sanitizeNick(jid.resource) + '!' + ircd.sanitizeUser(jid.resource);
    this.irc.command('NICK', ircd.sanitizeNick(newNick), nick);
  },

  ircTopic: function(jid, topic, delay) {
    if (delay) {
      delay = Math.floor(new Date(delay).getTime() / 1000);
      // RPL_TOPIC
      this.irc.reply('332', '#' + this.name + ' :' + topic);
      // RPL_TOPICWHOTIME
      this.irc.reply('333', '#' + this.name + ' ' + ircd.sanitizeUser(jid.resource) + ' ' + delay);
    }
    else {
      var nick = ircd.sanitizeNick(jid.resource);
      this.irc.command('TOPIC', '#' + this.name + ' :' + topic, nick);
    }
    this.topic = topic;
  },

  jabberRoomMessage: function(body) {
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
    //<presence from='ds@conference.chat.developmentseed.org/konstantin' to='konstantin@chat.developmentseed.org/164316818812955016904872' type='error' id='medium3'><x xmlns='http://jabber.org/protocol/muc'/><error code='409' type='cancel'><conflict xmlns='urn:ietf:params:xml:ns:xmpp-stanzas'/><text xmlns='urn:ietf:params:xml:ns:xmpp-stanzas'>Nickname is already in use by another occupant</text></error></presence>


    var id = presence.from;
    var existing = id in this.members;
    if (!existing) this.members[id] = {};
    var info = this.members[id];

    var item = path(presence, 'x.item');
    info.role = item.role || '';
    info.nick = jid.resource;
    info.realJID = item.jid;
    info.ircNick = ircd.sanitizeNick(info.nick);

    // When join a room, the presence of the current user is announced last.
    // That means, when we encounter a presence notification for ourselves, we
    // know that the initial list of items is complete for this room and we can
    // continue with the joining process.
    if (!this.joined && id === this.nickJID) {
      // Continue with the joining process; the user's presence is now signalled
      // to jabber and the complete list of users should be stored in this object.
      // We can now send the join message to IRC.
      this.joined = true;
      this.ircJoin(jid, info);
      this.ircNames();
    }
    else if (this.joined) {
      // User already joined. This is a notification for a new user.
      if (presence.type === 'unavailable') {
        // nick changes also masquerade as unavailable. Find out if it's a change:
        var status = path(presence, 'x.status');

        if (status && status.code === '303') {
          // Nickname change.
          this.ircNick(jid, item.nick);
          // Rename the entry in the member hash.
          info.nick = item.nick;
          info.ircNick = ircd.sanitizeNick(info.nick);
          info.realJID = item.jid;
          jid.resource = item.nick;
          this.members[jid.asJID()] = info;
          this.members[id] = undefined;
        }
        else {
          // Real part.
          this.ircPart(jid);
          delete this.members[id];
        }
      }
      else if (!existing) {
        this.ircJoin(jid, info);
      }
      else {
        // This may occur after a nick change when an additional presence
        // notification is sent. However, we already sent the nickname change
        // to IRC so we're done here.
        if (config.debug) console.log(RED('UNKNOWN PRESENCE OF USER'));
      }
    }
  },

  jabberLeave: function() {
    if (this.joined) this.jabber.leaveRoom(this.JID);
  },

  destroy: function() {
    this.jabberLeave();
  }
};
