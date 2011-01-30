exports.xml = {
  $escapes: {'<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;', '&': '&amp;' },
  $escape: function(str) {
    return str.replace(/[<>"'&]/g, function(c) {
      return c in exports.xml.$escapes ? exports.xml.$escapes[c] : c;
    });
  },
  $render: function(element) {
    var text = '<' + element.$name;
    for (var key in element.$attrs) {
      // if (typeof element.$attrs[key] === 'undefined') if (config.debug) console.log(GRAY('UNDEFINED KEY: ' + key));
      text += ' ' + key + '="' + exports.xml.$escape(element.$attrs[key]) + '"';
    }

    if (!element.length) return text + '/>';
    else {
      var children = element.map(function(e) {
        return e instanceof Array ? exports.xml.$render(e) : exports.xml.$escape(e);
      }).join('');
      return text + '>' + children + '</' + element.$name + '>';
    }
  },

  $: function(name, attrs) {
    var element = Array.prototype.slice.call(arguments, 2);
    element.$name = name;
    element.$attrs = attrs || {};
    return element;
  }
};

exports.xmlFind = function find(xml, name) {
  var result = [];
  for (var i = 0; i < xml.length; i++) {
    if (xml[i].$name === name) result.push(xml[i]);
  }
  return result;
};

exports.xmlPath = function path(xml, path) {
  path = path.split('.');
  xml = [ xml ];

  for (var k = 0; k < path.length; k++) {
    var elements = [];
    for (var j = 0; j < xml.length; j++) {
      for (var i = 0; i < xml[j].length; i++) {
        if (xml[j][i].$name === path[k]) {
          elements.push(xml[j][i]);
        }
      }
    }
    if (elements.length) xml = elements;
    else return;
  }

  return xml[0];
};

exports.xml.auth = exports.xml.$.bind(undefined, 'auth');
exports.xml.iq = exports.xml.$.bind(undefined, 'iq');
exports.xml.query = exports.xml.$.bind(undefined, 'query');
exports.xml.bind = exports.xml.$.bind(undefined, 'bind');
exports.xml.session = exports.xml.$.bind(undefined, 'session');
exports.xml.presence = exports.xml.$.bind(undefined, 'presence');
exports.xml.x = exports.xml.$.bind(undefined, 'x');
exports.xml.message = exports.xml.$.bind(undefined, 'message');
exports.xml.body = exports.xml.$.bind(undefined, 'body');
