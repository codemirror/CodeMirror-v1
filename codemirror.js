/* CodeMirror main module
 *
 * Implements the CodeMirror constructor and prototype, which take care
 * of initializing the editor frame, and providing the outside interface.
 */

// The CodeMirrorConfig object is used to specify a default
// configuration. If you specify such an object before loading this
// file, the values you put into it will override the defaults given
// below. You can also assign to it after loading.
var CodeMirrorConfig = window.CodeMirrorConfig || {};

var CodeMirror = (function(){
  function setDefaults(object, defaults) {
    for (var option in defaults) {
      if (!object.hasOwnProperty(option))
        object[option] = defaults[option];
    }
  }
  function forEach(array, action) {
    for (var i = 0; i < array.length; i++)
      action(array[i]);
  }

  // These default options can be overridden by passing a set of
  // options to a specific CodeMirror constructor. See manual.html for
  // their meaning.
  setDefaults(CodeMirrorConfig, {
    stylesheet: "",
    path: "",
    parserfile: [],
    basefiles: ["Mochi.js", "util.js", "stringstream.js", "select.js", "editor.js"],
    linesPerPass: 10,
    passDelay: 300,
    width: "100%",
    height: "300px"
  });

  function CodeMirror(place, options) {
    // Use passed options, if any, to override defaults.
    this.options = options = options || {};
    setDefaults(options, CodeMirrorConfig);

    frame = document.createElement("IFRAME");
    frame.style.border = "0";
    frame.style.width = options.width;
    frame.style.height = options.height;
    // display: block occasionally suppresses some Firefox bugs, so we
    // always add it, redundant as it sounds.
    frame.style.display = "block";

    if (place.appendChild)
      place.appendChild(frame);
    else
      place(frame);

    this.win = frame.contentWindow;
    var self = this;
    frame.onload = function(){self.load();};

    if (typeof options.parserfile == "string")
      options.parserfile = [options.parserfile];
    var html = ["<html><head><link rel=\"stylesheet\" type=\"text/css\" href=\"" + options.stylesheet + "\"/>"];
    forEach(options.basefiles.concat(options.parserfile), function(file) {
      html.push("<script type=\"text/javascript\" src=\"" + options.path + file + "\"></script>");
    });
    html.push("</head><body style=\"border-width: 0;\" class=\"editbox\" spellcheck=\"false\"></body></html>");

    var doc = this.win.document;
    doc.open();
    doc.write(html.join(""));
    doc.close();
  }

  CodeMirror.prototype = {
    load: function() {
      this.editor = new this.win.Editor(window, this.options);
    },
    getCode: function() {
      return this.editor.getCode();
    }
  };

  CodeMirror.replace = function(element) {
    if (typeof element == "string")
      element = document.getElementById(element);
    return function(newElement) {
      element.parentNode.replaceChild(newElement, element);
    };
  }

  return CodeMirror;
})();
