**medium** is a IRC to Jabber Multi-user-chat gateway. It is designed to allow you to use your IRC client to participate in Jabber MUC rooms ("groupchat"). One-to-one chat to users in the Jabber MUC room is also possible. Regular Jabber messages to regular users and a roster is not supported.

It *exclusively* supports encrypted connections, both to the Jabber server and to the IRC client. It also expects the IRC client to support UTF-8 encoded room names, nicknames etc. 

This code is still in alpha; there is barely any error handling and sometimes the gateway crashes when it encounters an unimplemented feature.

## Installation

To install, you need [ndistro](https://github.com/visionmedia/ndistro). Then type `ndistro` in the root directory and run the gateway with `bin/node medium.js`.