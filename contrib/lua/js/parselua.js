/* 
 Simple parser for LUA 
 Written for Lua 5.1, based on parsecss and other parsers. 
 features: highlights keywords, strings, comments (no leveling supported! ("[==[")),tokens, basic indenting

 to make this parser highlight your special functions pass table with this functions names to parserConfig argument of creator,
	
 parserConfig: ["myfunction1","myfunction2"],
 */

 
function wordRegexp(words) {
    return new RegExp("^(?:" + words.join("|") + ")$", "i");
}
 
var luaCustomFunctions= wordRegexp([]);
 
function configureLUA(parserConfig){
	if(parserConfig)
	luaCustomFunctions= wordRegexp(parserConfig);
}


//long list of standard functions from lua manual
var luaStdFunctions = wordRegexp([
"_G","_VERSION","assert","collectgarbage","dofile","error","getfenv","getmetatable","ipairs","load","loadfile","loadstring","module","next","pairs","pcall","print","rawequal","rawget","rawset","require","select","setfenv","setmetatable","tonumber","tostring","type","unpack","xpcall",

"coroutine.create","coroutine.resume","coroutine.running","coroutine.status","coroutine.wrap","coroutine.yield",

"debug.debug","debug.getfenv","debug.gethook","debug.getinfo","debug.getlocal","debug.getmetatable","debug.getregistry","debug.getupvalue","debug.setfenv","debug.sethook","debug.setlocal","debug.setmetatable","debug.setupvalue","debug.traceback",

"close","flush","lines","read","seek","setvbuf","write",

"io.close","io.flush","io.input","io.lines","io.open","io.output","io.popen","io.read","io.stderr","io.stdin","io.stdout","io.tmpfile","io.type","io.write",

"math.abs","math.acos","math.asin","math.atan","math.atan2","math.ceil","math.cos","math.cosh","math.deg","math.exp","math.floor","math.fmod","math.frexp","math.huge","math.ldexp","math.log","math.log10","math.max","math.min","math.modf","math.pi","math.pow","math.rad","math.random","math.randomseed","math.sin","math.sinh","math.sqrt","math.tan","math.tanh",

"os.clock","os.date","os.difftime","os.execute","os.exit","os.getenv","os.remove","os.rename","os.setlocale","os.time","os.tmpname",

"package.cpath","package.loaded","package.loaders","package.loadlib","package.path","package.preload","package.seeall",

"string.byte","string.char","string.dump","string.find","string.format","string.gmatch","string.gsub","string.len","string.lower","string.match","string.rep","string.reverse","string.sub","string.upper",

"table.concat","table.insert","table.maxn","table.remove","table.sort"
]);



 var luaKeywords = wordRegexp(["and","break","elseif","false","nil","not","or","return",
				"true","function", "end", "if", "then", "else", "do", 
				"while", "repeat", "until", "for", "in", "local" ]);

 var luaIndentKeys = wordRegexp(["function", "if","repeat","for","while", "{"]);
 var luaUnindentKeys = wordRegexp(["end", "until", "}"]);
 var luaMiddleKeys = wordRegexp(["else","elseif"]);



var LUAParser = Editor.Parser = (function() {
  var tokenizeLUA = (function() {
    function normal(source, setState) {
      var ch = source.next();

   if (ch == "-" && source.equals("-")) {
        setState(inSLComment);
        return null;
      } 
	else if (ch == "\"" || ch == "'") {
        setState(inString(ch));
        return null;
      }
    if (ch == "[" && source.equals("[")) {
        setState(inMLString());
        return null;
      } 
	    
      else if (ch == "=") {
	if (source.equals("="))
		source.next();
        return "lua-token";
      }
  	
      else if (ch == ".") {
	if (source.equals("."))
		source.next();
	if (source.equals("."))
		source.next();
        return "lua-token";
      }
     
      else if (ch == "+" || ch == "-" || ch == "*" || ch == "/" || ch == "%" || ch == "^" || ch == "#" ) {
        return "lua-token";
      }
      else if (ch == ">" || ch == "<" || ch == "(" || ch == ")" || ch == "{" || ch == "}" || ch == "[" ) {
        return "lua-token";
      }
      else if (ch == "]" || ch == ";" || ch == ":" || ch == ",") {
        return "lua-token";
      }
      else if (source.equals("=") && (ch == "~" || ch == "<" || ch == ">")) {
        source.next();
        return "lua-token";
      }

     else if (/\d/.test(ch)) {
        source.nextWhile(matcher(/[\w.%]/));
        return "lua-number";
      }
      else {
        source.nextWhile(matcher(/[\w\\\-_.]/));
        return "lua-identifier";
      }
    }
 
function inSLComment(source, setState) {
      var start = true;
	var count=0;
      while (!source.endOfLine()) {
	 	var ch = source.next();
		if ((ch =="[") && start)
			if (source.equals("[")){
       				setState(inMLComment);
        			return null;
  				}
		if (start && (ch != "-"))
		     start = false;	
	}
	setState(normal);      		
     return "lua-comment";
	
    }

    function inMLComment(source, setState) {
      var dashes = 0;
      while (!source.endOfLine()) {
        var ch = source.next();
        if (dashes >= 2 && ch == "-" && source.equals("-")) {
          var dummy = source.next();
          setState(normal);
          break;
        }
        dashes = (ch == "]") ? dashes + 1 : 0;
      }
      return "lua-comment";
    }

    function inMLString(quote) {
      return function(source, setState) {
        while (!source.endOfLine()) {
          var ch = source.next();
          if (ch == "]" && source.equals("]")){
	    	source.next();
		setState(normal);
            	break;
		}
        }
	return "lua-string";
      };
    }


    function inString(quote) {
      return function(source, setState) {
        var escaped = false;
        while (!source.endOfLine()) {
          var ch = source.next();
          if (ch == quote && !escaped)
            break;
          escaped = !escaped && ch == "\\";
        }
        if (!escaped)
          setState(normal);
        return "lua-string";
      };
    }

    return function(source, startState) {
      return tokenizer(source, startState || normal);
    };
  })();

  function indentLUA(indentDepth, base) {
    return function(nextChars) {

      var closing = (luaUnindentKeys.test(nextChars) || luaMiddleKeys.test(nextChars));

 	
	return base + ( indentUnit * (indentDepth - (closing?1:0)) );
    };
  }

  
function parseLUA(source,basecolumn) {
     basecolumn = basecolumn || 0;
    
	var tokens = tokenizeLUA(source);
    var indentDepth = 0;

    var iter = {
      next: function() {
        var token = tokens.next(), style = token.style, content = token.content;

 
	
	if (style == "lua-identifier" && luaKeywords.test(content)){
	  token.style = "lua-keyword";
	}	
	if (style == "lua-identifier" && luaStdFunctions.test(content)){
	  token.style = "lua-stdfunc";
	}
	if (style == "lua-identifier" && luaCustomFunctions.test(content)){
	  token.style = "lua-customfunc";
	}

	if (luaIndentKeys.test(content))
          indentDepth++;
	else if (luaUnindentKeys.test(content))
	  indentDepth--;
        

        if (content == "\n")
          token.indentation = indentLUA( indentDepth, basecolumn);

        return token;
      },

      copy: function() {
        var  _tokenState = tokens.state, _indentDepth = indentDepth;
        return function(source) {
          tokens = tokenizeLUA(source, _tokenState);
      
	  indentDepth = _indentDepth;
          return iter;
        };
      }
    };
    return iter;
  }

  return {make: parseLUA, configure:configureLUA, electricChars: "delf}"};   //en[d] els[e] unti[l] elsei[f]  // this should be taken from Keys keywords
})();

