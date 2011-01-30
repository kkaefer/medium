**medium** is a IRC to Jabber Multi-user-chat gateway. It is designed to allow you to use your IRC client to participate in Jabber MUC rooms ("groupchat"). One-to-one chat to users in the Jabber MUC room is also possible. Regular Jabber messages to regular users and a roster is not supported.

It supports encrypted connections, both to the Jabber server and to the IRC client. It also expects the IRC client to support UTF-8 encoded room names, nicknames etc.

This code is still in alpha; there is barely any error handling and sometimes the gateway crashes when it encounters an unimplemented feature.

## Installation

To install, you need [ndistro](https://github.com/visionmedia/ndistro). Type `cd /usr/local/bin && curl https://github.com/visionmedia/ndistro/raw/master/install | sh`. Change to the root directory of medium, then type `ndistro`. Change some values in `settings.js` and run the gateway with `bin/node medium.js`.

## Configuration

Medium can only act as a gateway to one Jabber server at a time. The configuration is in `config.js`:

* `debug`: When set, the gateway outputs incoming and outcoming traffic to the command line.
* `xmpp.host`: The domain of the Jabber server
* `xmpp.jid`: The host part of the Jabber ID for connecting users. This is required for some servers where the `host` does not match the `jid`, e.g. Google Talk.
* `xmpp.muc`: The conference server.
* `xmpp.port`: Port for XMPP connection. Defaults to 5222.
* `xmpp.noSSL`: If set to `true`, the gateway will connect to a Jabber server without SSL.