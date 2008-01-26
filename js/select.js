/* Functionality for finding, storing, and re-storing selections
 *
 * This does not provide a generic API, just the minimal functionality
 * required by the CodeMirror system.
 */

// Namespace object.
var select = {};

(function() {
  var ie_selection = document.selection && document.selection.createRangeCollection;

  // Find the 'top-level' (defined as 'a direct child of the node
  // passed as the top argument') node that the given node is
  // contained in. Return null if the given node is not inside the top
  // node.
  function topLevelNodeAt(node, top) {
    while (node && node.parentNode != top)
      node = node.parentNode;
    return node;
  }

  // Find the top-level node that contains the node before this one.
  function topLevelNodeBefore(node, top) {
    while (!node.previousSibling && node.parentNode != top)
      node = node.parentNode;
    return topLevelNodeAt(node.previousSibling, top);
  }

  // Most functions are defined in two ways, one for the IE selection
  // model, one for the W3C one.
  if (ie_selection) {
    // Store the current selection in such a way that it can be
    // restored after we manipulated the DOM tree. For IE, we store
    // pixel coordinates.
    select.markSelection = function (win) {
      var selection = win.document.selection;
      var start = selection.createRange(), end = start.duplicate();
      var bookmark = start.getBookmark();
      start.collapse(true);
      end.collapse(false);

      var body = win.document.body;
      // And we better hope no fool gave this window a padding or a
      // margin, or all these computations will be in vain.
      return {start: {x: start.boundingLeft + body.scrollLeft - 1,
                      y: start.boundingTop + body.scrollTop},
              end: {x: end.boundingLeft + body.scrollLeft - 1,
                    y: end.boundingTop + body.scrollTop},
              window: win,
              bookmark: bookmark};
    };

    // Restore a stored selection.
    select.selectMarked = function(sel) {
      if (!sel)
        return;
      var range1 = sel.window.document.body.createTextRange(), range2 = range1.duplicate();
      if (sel.start.y < 0 || sel.end.y > sel.window.document.body.clientHeight) {
        range1.moveToBookmark(sel.bookmark);
      }
      else {
        range1.moveToPoint(sel.start.x, sel.start.y);
        range2.moveToPoint(sel.end.x, sel.end.y);
        range1.setEndPoint("EndToStart", range2);
      }
      range1.select();
    };

    // Get the top-level node that one end of the cursor is inside or
    // after. Note that this returns false for 'no cursor', and null
    // for 'start of document'.
    select.selectionTopNode = function(container, start) {
      var selection = container.ownerDocument.selection;
      if (!selection) return false;

      var range = selection.createRange();
      range.collapse(start);
      var around = range.parentElement();
      if (around && isAncestor(container, around)) {
        // Only use this node if the selection is not at its start.
        var range2 = range.duplicate();
        range2.moveToElementText(around);
        if (range.compareEndPoints("StartToStart", range2) == -1)
          return topLevelNodeAt(around, container);
      }
      // Fall-back hack
      range.pasteHTML("<span id='// temp //'></span>");
      var temp = container.ownerDocument.getElementById("// temp //");
      var result = topLevelNodeBefore(temp, container);
      removeElement(temp);
      return result;
    };

    // Like selectionTopNode, but also gives an offset of the cursor
    // within this node (in characters).
    select.selectionPosition = function(container, start) {
      var topNode = select.selectionTopNode(container, start);
      if (topNode === false) return null;
      if (topNode && topNode.nodeType == 3) throw "selectionPostion only works on normalized documents.";

      var range = container.ownerDocument.selection.createRange();
      range.collapse(start);
      var range2 = range.duplicate();
      range2.moveToElementText(topNode || container);
      range2.setEndPoint("EndToStart", range);
      return {node: topNode, offset: range2.text.length};
    };

    // Not needed in IE model -- see W3C model.
    select.replaceSelection = function(){};

    // Place the cursor after this.start. This is only useful when
    // manually moving the cursor instead of restoring it to its old
    // position.
    select.focusAfterNode = function(node, container) {
      var range = container.ownerDocument.body.createTextRange();
      range.moveToElementText(node || container);
      range.collapse(!node);
      range.select();
    };

    // Used to normalize the effect of the enter key, since browsers
    // do widely different things when pressing enter in designMode.
    select.insertNewlineAtCursor = function(window) {
      var selection = window.document.selection;
      if (selection) {
        var range = selection.createRange();
        range.pasteHTML("<br/>");
        range.collapse(false);
        range.select();
      }
    };

    // Get the BR node at the start of the line on which the cursor
    // currently is, and the offset into the line. Returns null as
    // node if cursor is on first line.
    select.cursorLine = function(container) {
      var selection = container.ownerDocument.selection;
      if (!selection) return null;

      var topNode = select.selectionTopNode(container, false);
      while (topNode && topNode.nodeName != "BR")
        topNode = topNode.previousSibling;

      var range = selection.createRange(), range2 = range.duplicate();
      if (topNode) {
        range2.moveToElementText(topNode);
        range2.collapse(false);
      }
      else {
        range2.moveToElementText(container);
        range2.collapse(true);
      }
      range.setEndPoint("StartToStart", range2);

      return {start: topNode, offset: range.text.length};
    };

    // Set the cursor inside a given textnode. The implementation for
    // IE is hopelessly crummy because it does not allow one to pass a
    // text node to moveToElementText. This won't work precisely if
    // there are newlines in the text node or text nodes immediately
    // in front of it.
    select.focusNode = function(container, start, end) {
      function rangeAt(node, offset) {
        var range = container.ownerDocument.body.createTextRange();
        var focusable = node && node.previousSibling;
        while (focusable && focusable.nodeType == 3) {
          offset += focusable.nodeValue.length;
          focusable = focusable.previousSibling;
        }
        if (!focusable) {
          range.moveToElementText(container);
          range.collapse(true);
        }
        else {
          range.moveToElementText(focusable);
          range.collapse(false);
        }
        range.move("character", offset);
        return range;
      }

      end = end || start;
      var range = rangeAt(end.node, end.offset);
      if (start.node != end.node || start.offset != end.offset)
        range.setEndPoint("StartToStart", rangeAt(start.node, start.offset));
      range.select();
    };

    // Make sure the cursor is visible.
    select.scrollToCursor = function(container) {
      var selection = container.ownerDocument.selection;
      if (!selection) return null;
      selection.createRange().scrollIntoView();
    };
  }
  // W3C model
  else {
    // This is used to fix an issue with getting the scroll position
    // in Opera.
    var opera_scroll = !window.scrollX && !window.scrollY;

    // Store start and end nodes, and offsets within these, and refer
    // back to the selection object from those nodes, so that this
    // object can be updated when the nodes are replaced before the
    // selection is restored.
    select.markSelection = function (win) {
      var selection = win.getSelection();
      if (!selection || selection.rangeCount == 0)
        return null;
      var range = selection.getRangeAt(0);

      var result = {start: {node: range.startContainer, offset: range.startOffset},
                    end: {node: range.endContainer, offset: range.endOffset},
                    window: win,
                    scrollX: opera_scroll && win.document.body.scrollLeft,
                    scrollY: opera_scroll && win.document.body.scrollTop};

      // We want the nodes right at the cursor, not one of their
      // ancestors with a suitable offset. This goes down the DOM tree
      // until a 'leaf' is reached (or is it *up* the DOM tree?).
      function normalize(point){
        while (point.node.nodeType != 3 && point.node.nodeName != "BR") {
          var newNode = point.node.childNodes[point.offset] || point.node.nextSibling;
          point.offset = 0;
          while (!newNode && point.node.parentNode) {
            point.node = point.node.parentNode;
            newNode = point.node.nextSibling;
          }
          point.node = newNode;
          if (!newNode)
            break;
        }
      }

      normalize(result.start);
      normalize(result.end);
      // Make the links back to the selection object (see
      // replaceSelection).
      if (result.start.node)
        result.start.node.selectStart = result.start;
      if (result.end.node)
        result.end.node.selectEnd = result.end;

      return result;
    };

    // Helper for selecting a range object.
    function selectRange(range, window) {
      var selection = window.getSelection();
      selection.removeAllRanges();
      selection.addRange(range);
    };
    function selectionRange(window) {
      var selection = window.getSelection();
      if (!selection || selection.rangeCount == 0)
        return false;
      else
        return selection.getRangeAt(0);
    }

    // Finding the top-level node at the cursor in the W3C is, as you
    // can see, quite an involved process.
    select.selectionTopNode = function(container, start) {
      var range = selectionRange(container.ownerDocument.defaultView);
      if (!range) return false;

      var node = start ? range.startContainer : range.endContainer;
      var offset = start ? range.startOffset : range.endOffset;

      // For text nodes, we look at the node itself if the cursor is
      // inside, or at the node before it if the cursor is at the
      // start.
      if (node.nodeType == 3){
        if (offset > 0)
          return topLevelNodeAt(node, container);
        else
          return topLevelNodeBefore(node, container);
      }
      // Occasionally, browsers will return the HTML node as
      // selection. If the offset is 0, we take the start of the frame
      // ('after null'), otherwise, we take the last node.
      else if (node.nodeName == "HTML") {
        return (offset == 1 ? null : container.lastChild);
      }
      // If the given node is our 'container', we just look up the
      // correct node by using the offset.
      else if (node == container) {
        return (offset == 0) ? null : node.childNodes[offset - 1];
      }
      // In any other case, we have a regular node. If the cursor is
      // at the end of the node, we use the node itself, if it is at
      // the start, we use the node before it, and in any other
      // case, we look up the child before the cursor and use that.
      else {
        if (offset == node.childNodes.length)
          return topLevelNodeAt(node, container);
        else if (offset == 0)
          return topLevelNodeBefore(node, container);
        else
          return topLevelNodeAt(node.childNodes[offset - 1], container);
      }
    };

    select.selectionPosition = function(container, start) {
      var topNode = select.selectionTopNode(container, start);
      if (topNode === false) return null;

      var range = selectionRange(container.ownerDocument.defaultView).cloneRange();
      range.collapse(start);
      range.setStartBefore(topNode || container);
      return {node: topNode, offset: range.toString().length};
    };

    select.selectMarked = function (sel) {
      if (!sel)
        return;
      var win = sel.window;
      var range = win.document.createRange();

      function setPoint(point, which) {
        if (point.node) {
          // Remove the link back to the selection.
          delete point.node["select" + which];
          // Some magic to generalize the setting of the start and end
          // of a range.
          if (point.offset == 0)
            range["set" + which + "Before"](point.node);
          else
            range["set" + which](point.node, point.offset);
        }
        else {
          range.setStartAfter(win.document.body.lastChild || win.document.body);
        }
      }

      // Have to restore the scroll position of the frame in Opera.
      if (opera_scroll){
        sel.window.document.body.scrollLeft = sel.scrollX;
        sel.window.document.body.scrollTop = sel.scrollY;
      }
      setPoint(sel.end, "End");
      setPoint(sel.start, "Start");
      selectRange(range, win);
    };

    // This is called by the code in codemirror.js whenever it is
    // replacing a part of the DOM tree. The function sees whether the
    // given oldNode is part of the current selection, and updates
    // this selection if it is. Because nodes are often only partially
    // replaced, the length of the part that gets replaced has to be
    // taken into account -- the selection might stay in the oldNode
    // if the newNode is smaller than the selection's offset. The
    // offset argument is needed in case the selection does move to
    // the new object, and the given length is not the whole length of
    // the new node (part of it might have been used to replace
    // another node).
    select.replaceSelection = function(oldNode, newNode, length, offset) {
      function replace(which) {
        var selObj = oldNode["select" + which];
        if (selObj) {
          if (selObj.offset > length) {
            selObj.offset -= length;
          }
          else {
            newNode["select" + which] = selObj;
            delete oldNode["select" + which];
            selObj.node = newNode;
            selObj.offset += (offset || 0);
          }
        }
      }
      replace("Start");
      replace("End");
    };

    select.focusAfterNode = function(node, container) {
      var win = container.ownerDocument.defaultView,
          range = win.document.createRange();
      range.setStartBefore(container.firstChild || container);
      // In Opera, setting the end of a range at the end of a line
      // (before a BR) will cause the cursor to appear on the next
      // line, so we set the end inside of the start node when
      // possible.
      if (node && !node.firstChild)
        range.setEndAfter(node);
      else if (node)
        range.setEnd(node, node.childNodes.length);
      else
        range.setEndBefore(container.firstChild || container);
      range.collapse(false);
      selectRange(range, win);
    };

    select.insertNewlineAtCursor = function(window) {
      var range = selectionRange(window);
      if (!range) return;

      var br = window.document.createElement("BR");
      // On Opera, insertNode is completely broken when the range is
      // in the middle of a text node.
      if (window.opera && range.startContainer.nodeType == 3 && range.startOffset != 0) {
        var start = range.startContainer, text = start.nodeValue;
        start.parentNode.insertBefore(window.document.createTextNode(text.substr(0, range.startOffset)), start);
        start.nodeValue = text.substr(range.startOffset);
        start.parentNode.insertBefore(br, start);
      }
      else {
        range.insertNode(br);
      }

      range.setEndAfter(br);
      range.collapse(false);
      selectRange(range, window);
    };

    select.cursorLine = function(container) {
      var range = selectionRange(window);
      if (!range) return;

      var topNode = select.selectionTopNode(container, false);
      while (topNode && topNode.nodeName != "BR")
        topNode = topNode.previousSibling;

      range = range.cloneRange();
      if (topNode)
        range.setStartAfter(topNode);
      else
        range.setStartBefore(container);
      return {start: topNode, offset: range.toString().length};
    };

    select.focusNode = function(container, start, end) {
      end = end || start;
      var win = container.ownerDocument.defaultView,
          range = win.document.createRange();
      function setPoint(point, side) {
        if (!point.node)
          range["set" + side + "Before"](container);
        else if (point.node.nodeType == 3)
          range["set" + side](point.node, point.offset);
        else
          range["set" + side + (point.offset ? "After" : "Before")](point.node);
      }
      setPoint(end, "End");
      setPoint(start, "Start");
      selectRange(range, win);
    };

    select.scrollToCursor = function(container) {
      var body = container.ownerDocument.body, win = container.ownerDocument.defaultView;
      var element = select.selectionTopNode(container, true) || container.firstChild;
      
      // In Opera, BR elements *always* have a scrollTop property of zero. Go Opera.
      while (element && window.opera && element.nodeName == "BR")
        element = element.previousSibling;

      var y = 0, pos = element;
      while (pos && pos.offsetParent) {
        y += pos.offsetTop;
        pos = pos.offsetParent;
      }

      var screen_y = y - body.scrollTop;
      if (screen_y < 0 || screen_y > win.innerHeight - 10)
        win.scrollTo(0, y);
    };
  }
}());
