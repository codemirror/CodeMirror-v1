// Selection

var ie_selection = document.selection && document.selection.getClientRects;

function topLevelNodeAfter(node, top) {
  while (!node.nextSibling && node.parentNode != top)
    node = node.parentNode;
  var after = node.nextSibling;
  while (after && after.parentNode != top)
    after = after.parentNode;
  return after;
}

if (ie_selection) {
  var markSelection = function (win) {
    var selection = win.document.selection;
    var rects = selection.createRange().getClientRects();
    var start = rects[0], end = rects[rects.length - 1];
    // The -1 is to prevent a problem where the cursor would end up on
    // the next line sometimes.
    return {start: {x: start.left - 1, y: start.top},
            end: {x: end.right - 1, y: end.top},
            window: win};
  };

  var selectMarked = function(sel) {
    if (!sel)
      return;
    var range1 = sel.window.document.body.createTextRange(), range2 = range1.duplicate();
    range1.moveToPoint(sel.start.x, sel.start.y);
    range2.moveToPoint(sel.end.x, sel.end.y);
    range1.setEndPoint("EndToStart", range2);
    range1.select();
  };

  var replaceSelection = function(){};

  var Cursor = function(container) {
    this.container = container;
    this.doc = container.ownerDocument;
    var selection = this.doc.selection;
    this.valid = !!selection;
    if (this.valid) {
      var range = selection.createRange();
      range.collapse(false);
      var around = range.parentElement();
      if (around && isAncestor(container, around)) {
        this.after = topLevelNodeAfter(around, container);
      }
      else {
        range.pasteHTML("<span id='// temp //'></span>");
        var temp = this.doc.getElementById("// temp //");
        this.after = topLevelNodeAfter(temp, container);
        removeElement(temp);
      }
    }
  };

  Cursor.prototype.focus = function () {
    var range = this.doc.body.createTextRange();
    range.moveToElementText(this.after || this.container);
    range.collapse(true);
    range.select();
  };

  var insertNewlineAtCursor = function(window) {
    var selection = window.document.selection;
    if (selection) {
      var range = selection.createRange();
      range.pasteHTML("<br/>");
      range.collapse(false);
      range.select();
    }
  };
}
else {
  var markSelection = function (win) {
    var selection = win.getSelection();
    if (!selection || selection.rangeCount == 0)
      return null;
    var range = selection.getRangeAt(0);

    var result = {start: {node: range.startContainer, offset: range.startOffset},
                  end: {node: range.endContainer, offset: range.endOffset},
                  window: win};
    
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
    if (result.start.node)
      result.start.node.selectStart = result.start;
    if (result.end.node)
      result.end.node.selectEnd = result.end;

    return result;
  };

  var selectRange = function(range, window) {
    var selection = window.getSelection();
    selection.removeAllRanges();
    selection.addRange(range);
  };
   
  var selectMarked = function (sel) {
    if (!sel)
      return;
    var win = sel.window;
    var range = win.document.createRange();

    function setPoint(point, which) {
      if (point.node) {
        delete point.node["select" + which];
        if (point.offset == 0)
          range["set" + which + "Before"](point.node);
        else
          range["set" + which](point.node, point.offset);
      }
      else {
        range.setStartAfter(win.document.body);
      }
    }

    setPoint(sel.start, "Start");
    setPoint(sel.end, "End");
    selectRange(range, win);
  };

  var replaceSelection = function(oldNode, newNode, length, offset) {
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

  var Cursor = function(container) {
    this.container = container;
    this.win = container.ownerDocument.defaultView;
    var selection = this.win.getSelection();
    this.valid = selection && selection.rangeCount > 0;
    if (this.valid) {
      var range = selection.getRangeAt(0);
      var end = range.endContainer;
      if (end.nodeType != 3 && end.childNodes.length > 0) {
        this.after = end.childNodes[range.endOffset];
        while (this.after && this.after.parentNode != container)
          this.after = this.after.parentNode;
      }
      else {
        this.after = topLevelNodeAfter(end, container);
      }
    }
  };

  Cursor.prototype.focus = function() {
    var range = this.win.document.createRange();
    range.setStartBefore(this.container);
    range.setEndBefore(this.after || this.container);
    range.collapse(false);
    selectRange(range, this.win);
  };
}

Cursor.prototype.startOfLine = function() {
  var start = this.after ? this.after.previousSibling : this.container.lastChild;
  while (start && start.nodeName != "BR")
    start = start.previousSibling;
  return start;
};
