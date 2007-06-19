// Selection

var ie_selection = document.selection && document.selection.createRangeCollection;

function topLevelNodeAt(node, top) {
  while (node && node.parentNode != top)
    node = node.parentNode;
  return node;
}

function topLevelNodeBefore(node, top) {
  while (!node.previousSibling && node.parentNode != top)
    node = node.parentNode;
  return topLevelNodeAt(node.previousSibling, top);
}

if (ie_selection) {
  var markSelection = function (win) {
    var selection = win.document.selection;
    var start = selection.createRange(), end = start.duplicate();
    start.collapse(true);
    end.collapse(false);
    
    var body = win.document.body;
    // And we better hope no fool gave this window a padding or a
    // margin, or all these computations will be in vain.
    return {start: {x: start.boundingLeft + body.scrollLeft - 1,
                    y: start.boundingTop + body.scrollTop},
            end: {x: end.boundingLeft + body.scrollLeft - 1,
                  y: end.boundingTop + body.scrollTop},
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
        this.start = topLevelNodeAt(around, container);
      }
      else {
        range.pasteHTML("<span id='// temp //'></span>");
        var temp = this.doc.getElementById("// temp //");
        this.start = topLevelNodeBefore(temp, container);
        removeElement(temp);
      }
    }
  };

  Cursor.prototype.focus = function () {
    var range = this.doc.body.createTextRange();
    range.moveToElementText(this.start || this.container);
    range.collapse(!this.start);
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
  var opera_scroll = !window.scrollX && !window.scrollY;

  var markSelection = function (win) {
    var selection = win.getSelection();
    if (!selection || selection.rangeCount == 0)
      return null;
    var range = selection.getRangeAt(0);

    var result = {start: {node: range.startContainer, offset: range.startOffset},
                  end: {node: range.endContainer, offset: range.endOffset},
                  window: win,
                  scrollX: opera_scroll && win.document.body.scrollLeft,
                  scrollY: opera_scroll && win.document.body.scrollTop};
    
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
        range.setStartAfter(win.document.body.lastChild || win.document.body);
      }
    }

    if (opera_scroll){
      sel.window.document.body.scrollLeft = sel.scrollX;
      sel.window.document.body.scrollTop = sel.scrollY;
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
      if (end.nodeType == 3){
        if (range.endOffset > 0)
          this.start = topLevelNodeAt(end, this.container);
        else
          this.start = topLevelNodeBefore(end, this.container);
      }
      else if (end.nodeName == "HTML") {
        this.start = (range.endOffset == 1 ? null : container.lastChild);
      }
      else if (end == container) {
        if (range.endOffset == 0)
          this.start = null;
        else
          this.start = end.childNodes[range.endOffset - 1];
      }
      else {
        if (range.endOffset == end.childNodes.length)
          this.start = topLevelNodeAt(end, this.container);
        else if (range.endOffset == 0)
          this.start = topLevelNodeBefore(end, this.container);
        else
          this.start = topLevelNodeAt(end.childNodes[range.endOffset - 1], this.container);
      }
    }
  };

  Cursor.prototype.focus = function() {
    var range = this.win.document.createRange();
    range.setStartBefore(this.container.firstChild || this.container);
    if (this.start)
      range.setEndAfter(this.start);
    else
      range.setEndBefore(this.container.firstChild || this.container);
    range.collapse(false);
    selectRange(range, this.win);
  };

  var insertNewlineAtCursor = function(window) {
    var selection = window.getSelection();
    if (selection && selection.rangeCount > 0) {
      var range = selection.getRangeAt(0);
      var br = withDocument(window.document, BR);
      range.insertNode(br);
      range.setEndAfter(br);
      range.collapse(false);
      selectRange(range, window);
    }
  };
}

Cursor.prototype.startOfLine = function() {
  var start = this.start || this.container.firstChild;
  while (start && start.nodeName != "BR")
    start = start.previousSibling;
  return start;
};
