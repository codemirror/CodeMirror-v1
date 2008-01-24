/**
 * Storage and control for undo information within a CodeMirror
 * editor. 'Why on earth is such a complicated mess required for
 * that?', I hear you ask. The goal, in implementing this, was to make
 * the complexity of storing and reverting undo information depend
 * only on the size of the edited or restored content, not on the size
 * of the whole document. This makes it necessary to use a kind of
 * 'diff' system, which, when applied to a DOM tree, causes some
 * complexity and hackery.
 *
 * In short, the editor 'touches' BR elements as it parses them, and
 * the History stores these. When nothing is touched in commitDelay
 * milliseconds, the changes are committed: It goes over all touched
 * nodes, throws out the ones that did not change since last commit or
 * are no longer in the document, and assembles the rest into zero or
 * more 'chains' -- arrays of adjacent lines. Links back to these
 * chains are added to the BR nodes, while the chain that previously
 * spanned these nodes is added to the undo history. Undoing a change
 * means taking such a chain off the undo history, restoring its
 * content (text is saved per line) and linking it back into the
 * document.
 */

// A history object needs to know about the DOM container holding the
// document, the maximum amount of undo levels it should store, the
// delay (of no input) after which it commits a set of changes, and,
// unfortunately, the 'parent' window -- a window that is not in
// designMode, and on which setTimeout works in every browser.
function History(container, maxDepth, commitDelay, parent) {
  this.container = container;
  this.maxDepth = maxDepth; this.commitDelay = commitDelay;
  this.parent = parent;
  // This line object represents the initial, empty editor.
  var initial = {text: "", from: null, to: null};
  // As the borders between lines are represented by BR elements, the
  // start of the first line and the end of the last one are
  // represented by null. Since you can not store any properties
  // (links to line objects) in null, these properties are used in
  // those cases.
  this.first = initial; this.last = initial;
  // Similarly, a 'historyTouched' property is added to the BR in
  // front of lines that have already been touched, and 'firstTouched'
  // is used for the first line.
  this.firstTouched = false;
  // History is the set of committed changes, touched is the set of
  // nodes touched since the last commit.
  this.history = []; this.touched = [];
}

History.prototype = {
  // Mark a node as touched. Null is a valid argument.
  touch: function(node) {
    this.setTouched(node);
    // Schedule a commit (if no other touches come in for commitDelay
    // milliseconds).
    this.parent.clearTimeout(this.commitTimeout);
    this.commitTimeout = this.parent.setTimeout(method(this, "commit"), this.commitDelay);
  },

  // Undo the last change.
  undo: function() {
    this.parent.clearTimeout(this.commitTimeout);
    // Make sure pending changes have been committed.
    this.commit();

    // If there is no undo info left, bail.
    if (!this.history.length) return [];
    
    // The history contains an array of line chains.
    var data = this.history.pop();
    // Store the current equivalents of these chains, in case the user
    // wants to redo.
    this.redoData = map(method(this, "shadowChain"), data);
    // The editor wants to know which nodes it should reparse, so
    // revertChain returns those.
    return map(method(this, "revertChain"), data);
  },

  // Redo the last undone change (only works once, no history is
  // stored for this).
  redo: function() {
    this.commit();
    if (!this.redoData)
      return [];

    // Store the changes we are about to redo, so they can be undone
    // again.
    this.addUndoLevel(map(method(this, "shadowChain"), this.redoData));
    // Revert changes, save dirty nodes.
    var dirty = map(method(this, "revertChain"), this.redoData);
    // Clean up redo data.
    this.redoData = null;
    return dirty;
  },

  // Clear the undo history, link the current document (which is
  // expected to be just text nodes and BRs).
  reset: function() {
    this.history = []; this.redoData = null;
    var chain = [], line = "", start = null;
    var pos = this.container.firstChild;
    while (true) {
      if (!pos || pos.nodeName == "BR") {
        chain.push({from: start, to: pos, text: line});
        line = ""; start = pos;
      }
      else if (pos.nodeType == 3) {
        line += pos.nodeValue;
      }
      else {
        throw "Invalid history reset: " + pos.nodeName + " node found.";
      }
      if (!pos) break;
      pos = pos.nextSibling;
    }
    this.linkChain(chain);
  },

  // [ end of public interface ]

  // Check whether the touched nodes hold any changes, if so, commit
  // them.
  commit: function() {
    // Build set of chains.
    var chains = this.touchedChains(), self = this;
    if (!chains.length) return;

    // Link the chains into the DOM nodes, getting back their
    // predecessors.
    function commitChain(chain) {
      var shadow = self.shadowChain(chain);
      self.linkChain(chain);
      return shadow;
    };
    // Store the changes.
    this.addUndoLevel(map(commitChain, chains));
    // Any redo data is now out of date, so clear it.
    this.redoData = null;
  },

  // Link a chain into the DOM nodes (or the first/last links for null
  // nodes).
  linkChain: function(chain) {
    for (var i = 0; i < chain.length; i++) {
      var line = chain[i];
      if (line.from) line.from.historyAfter = line;
      else this.first = line;
      if (line.to) line.to.historyBefore = line;
      else this.last = line;
    }
  },

  // Get the line object after/before a given node.
  after: function(node) {
    return node ? node.historyAfter : this.first;
  },
  before: function(node) {
    return node ? node.historyBefore : this.last;
  },

  // Mark a node as touched if it has not already been marked.
  setTouched: function(node) {
    if (node) {
      if (!node.historyTouched) {
        this.touched.push(node);
        node.historyTouched = true;
      }
    }
    else {
      this.firstTouched = true;
    }
  },

  // Store a new set of undo info, throw away info if there is more of
  // it than allowed.
  addUndoLevel: function(diffs) {
    this.history.push(diffs);
    if (this.history.length > this.maxDepth)
      this.history.shift();
  },

  // Build chains from a set of touched nodes.
  touchedChains: function() {
    var self = this;
    // Compare two strings, treating nbsps as spaces.
    var nbspRegex = new RegExp(nbsp, "g");
    function compareText(a, b) {
      return a.replace(nbspRegex, " ") == b.replace(nbspRegex, " ");
    }

    // The temp system is a crummy hack to speed up determining
    // whether a (currently touched) node has a line object associated
    // with it. nullTemp is used to store the object for the first
    // line, other nodes get it stored in their historyTemp property.
    var nullTemp = null;
    function temp(node) {return node ? node.historyTemp : nullTemp;}
    function setTemp(node, line) {
      if (node) node.historyTemp = line;
      else nullTemp = line;
    }

    // Filter out unchanged lines and nodes that are no longer in the
    // document. Build up line objects for remaining nodes.
    var lines = [];
    if (self.firstTouched) self.touched.push(null);
    forEach(self.touched, function(node) {
      if (node) {
        node.historyTouched = false;
        if (node.parentNode != self.container)
          return;
      }
      else {
        self.firstTouched = false;
      }

      var text = [];
      for (var cur = node ? node.nextSibling : self.container.firstChild;
           cur && cur.nodeName != "BR"; cur = cur.nextSibling)
        if (cur.currentText) text.push(cur.currentText);

      var line = {from: node, to: cur, text: text.join("")};
      var shadow = self.after(node);
      if (!shadow || !compareText(shadow.text, line.text) || shadow.to != line.to) {
        lines.push(line);
        setTemp(node, line);
      }
    });

    // Get the BR element after/before the given node.
    function nextBR(node, dir) {
      var link = dir + "Sibling", search = node[link];
      while (search && search.nodeName != "BR")
        search = search[link];
      return search;
    }

    // Assemble line objects into chains by scanning the DOM tree
    // around them.
    var chains = []; self.touched = [];
    forEach(lines, function(line) {
      // Note that this makes the loop skip line objects that have
      // been pulled into chains by lines before them.
      if (!temp(line.from)) return;

      var chain = [], curNode = line.from;
      // Put any line objects (referred to by temp info) before this
      // one on the front of the array.
      while (true) {
        var curLine = temp(curNode);
        if (!curLine) break;
        chain.unshift(curLine);
        setTemp(curNode, null);
        if (!curNode) break;
        curNode = nextBR(curNode, "previous");
      }
      curNode = line.to;
      // Add lines after this one at end of array.
      while (true) {
        var curLine = temp(curNode);
        if (!curLine || !curNode) break;
        chain.push(curLine);
        setTemp(curNode, null);
        curNode = nextBR(curNode, "next");
      }

      // Chains that can not determine a valid 'shadow' -- a chain
      // currently stored in the DOM tree that has the same start and
      // end point -- are put back into the touched set, hoping they
      // will be valid next time.
      if (self.after(chain[0].from) && self.before(chain[chain.length - 1].to))
        chains.push(chain);
      else
        forEach(chain, function(line) {self.setTouched(line.from);});
    });

    return chains;
  },

  // Find the 'shadow' of a given chain by following the links in the
  // DOM nodes at its start and end.
  shadowChain: function(chain) {
    var shadows = [], next = this.after(chain[0].from), end = chain[chain.length - 1].to;
    while (true) {
      shadows.push(next);
      var nextNode = next.to;
      if (!nextNode || nextNode == end)
        break;
      else
        next = nextNode.historyAfter;
    }
    return shadows;
  },

  // Update the DOM tree to contain the lines specified in a given
  // chain, link this chain into the DOM nodes.
  revertChain: function(chain) {
    // Some attempt is made to prevent the cursor from jumping
    // randomly when an undo or redo happens. It still behaves a bit
    // strange sometimes.
    var cursor = select.cursorLine(this.container), self = this;

    // Remove all nodes in the DOM tree between from and to (null for
    // start/end of container).
    function removeRange(from, to) {
      var pos = from ? from.nextSibling : self.container.firstChild;
      while (pos != to) {
        var temp = pos.nextSibling;
        removeElement(pos);
        pos = temp;
      }
    }

    var start = chain[0].from, end = chain[chain.length - 1].to;
    // Clear the space where this change has to be made.
    removeRange(start, end);

    // Build a function that will insert nodes before the end node of
    // this chain.
    var insert = end ?
      function(node) {self.container.insertBefore(node, end);}
    : function(node) {self.container.appendChild(node);};

    // Insert the content specified by the chain into the DOM tree.
    for (var i = 0; i < chain.length; i++) {
      var line = chain[i];
      // The start and end of the space are already correct, but BR
      // tags inside it have to be put back.
      if (i > 0)
        insert(line.from);
      // Add the text.
      var textNode = this.container.ownerDocument.createTextNode(line.text);
      insert(textNode);
      // See if the cursor was on this line. Put it back (vaguely
      // adjusting for changed line length) if it was.
      if (cursor && cursor.start == line.from) {
        var prev = this.after(line.from);
        var cursordiff = (prev && i == chain.length - 1) ? line.text.length - prev.text.length : 0;
        select.focusInText(textNode, Math.max(0, Math.min(cursor.offset + cursordiff, line.text.length)));
      }
    }

    // Anchor the chain in the DOM tree.
    this.linkChain(chain);
    return start;
  }
};
