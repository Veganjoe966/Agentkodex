'use strict';

function encode(message) {
  return `${JSON.stringify(message)}\n`;
}

function createLineParser(onMessage, onInvalid) {
  let buffer = '';
  return function push(chunk) {
    buffer += chunk.toString('utf8');
    let index = buffer.indexOf('\n');
    while (index !== -1) {
      const line = buffer.slice(0, index).trim();
      buffer = buffer.slice(index + 1);
      if (line) {
        try {
          onMessage(JSON.parse(line));
        } catch (error) {
          if (onInvalid) onInvalid(error, line);
        }
      }
      index = buffer.indexOf('\n');
    }
  };
}

module.exports = { encode, createLineParser };
