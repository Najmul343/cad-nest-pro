/*!
 * Browser adapter for the unmodified Jack000/Deepnest engine.
 *
 * Keep Deepnest's engine files byte-identical. This shim only adapts the
 * parser call signature expected by main/svgnest.js when running in-browser.
 */
(function(root){
	'use strict';

	if(!root.SvgParser || !root.SvgParser.load){
		return;
	}

	var load = root.SvgParser.load;
	root.SvgParser.load = function(dirpath, svgString, scale, scalingFactor){
		if(arguments.length === 1 && typeof dirpath === 'string'){
			return load(null, dirpath, 72, null);
		}
		return load(dirpath, svgString, scale, scalingFactor);
	};
})(this);
