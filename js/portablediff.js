module(function(exports) {
exports.getInfo = function() {
    return {
        name: "diff",
        fileexts: [ "diff", "patch" ],
        mimetypes: [ "application/x-diff" ]
    };
}

exports.getRules = function() {
    return {
        start: [
            { regex: /\+.*/, token: 'addition' },
            { regex: /-.*/, token: 'deletion' },
            { regex: /.*/, token: 'plain' }
        ]
    };
}
});
