var colors = {
  'black': '30',
  'red': '31',
  'green': '32',
  'brown': '33',
  'blue': '34',
  'purple': '35',
  'cyan': '36',
  'gray': '37',
  'brown': '33'
};

function color(col) {
  return function(str) {
    return '\033[' + colors[col] + 'm' + str + '\033[0m';
  };
}

for (var key in colors) {
  global[key.toUpperCase()] = color(key);
}
