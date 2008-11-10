/* String streams are the things fed to parsers (which can feed them
 * to a tokenizer if they want). They provide peek and next methods
 * for looking at the current character (next 'consumes' this
 * character, peek does not), and a get method for retrieving all the
 * text that was consumed since the last time get was called.
 *
 * An easy mistake to make is to let a StopIteration exception finish
 * the token stream while there are still characters pending in the
 * string stream (hitting the end of the buffer while parsing a
 * token). To make it easier to detect such errors, the strings throw
 * an exception when this happens.
 */

(function(){
  // Generic operations that apply to stringstreams.
  var base = {
    more: function() {
      return this.peek() !== null;
    },
    applies: function(test) {
      var next = this.peek();
      return (next !== null && test(next));
    },
    nextWhile: function(test) {
      while (this.applies(test))
        this.next();
    },
    equals: function(ch) {
      return ch === this.peek();
    },
    endOfLine: function() {
      var next = this.peek();
      return next == null || next == "\n";
    },
    matches: function(string, caseSensitive) {
      for (var i = 0; i < string.length; i++) {
        var ch = this.peek();
        if (!ch || string.charAt(i) != (caseSensitive ? ch : ch.toLowerCase()))
          return false;
        this.next();
      }
      return true;
    }
  };

  // Make a string stream out of an iterator that returns strings. This
  // is applied to the result of traverseDOM (see codemirror.js), and
  // the resulting stream is fed to the parser.
  window.stringStream = function(source){
    source = iter(source);
    // String that's currently being iterated over.
    var current = "";
    // Position in that string.
    var pos = 0;
    // Holds a character if something has been peeked.
    var peeked = null;
    // Accumulator for strings that have been iterated over but not
    // get()-ed yet.
    var accum = "";

    return update({
      // Return the next character in the stream.
      peek: function() {
        if (!peeked) {
          try {peeked = this.step();}
          catch (e) {
            if (e != StopIteration) throw e;
            else peeked = null;
          }
        }
        return peeked;
      },
      // Internal function. Advance the stream by one character,
      // return that character. Throws StopIteration when at end of
      // stream.
      step: function() {
        if (peeked) {
          var temp = peeked;
          peeked = null;
          return temp;
        }
        // source.next() can return empty strings, so loop until we
        // have new characters
        while (pos == current.length) {
          accum += current;
          current = ""; // In case source.next() throws
          pos = 0;
          current = source.next();
        }
        return current.charAt(pos++);
      },
      // Get the next character, throw StopIteration if at end, check
      // for unused content.
      next: function() {
        try {return this.step();}
        catch (e) {
          if (e == StopIteration && accum.length > 0)
            throw "End of stringstream reached without emptying buffer ('" + accum + "').";
          else
            throw e;
        }
      },
      // Return the characters iterated over since the last call to
      // .get().
      get: function() {
        var temp = accum;
        var realPos = peeked ? pos - 1 : pos;
        accum = "";
        if (realPos > 0){
          temp += current.slice(0, realPos);
          current = current.slice(realPos);
          pos = peeked ? 1 : 0;
        }
        return temp;
      },
      // Reset to the state from the last call to .get().
      reset: function() {
        current = accum + current;
        accum = "";
        pos = 0;
        peeked = null;
      },
      // Push a string back into the stream.
      push: function(str) {
        current = current.slice(0, pos) + str + current.slice(pos);
      }
    }, base);
  };
})();
