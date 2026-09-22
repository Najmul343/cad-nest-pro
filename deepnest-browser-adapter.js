/*!
 * Browser adapter for the unmodified Jack000/SVGnest engine.
 *
 * Keep SVGnest's engine files byte-identical. This shim only adapts the
 * parser helpers expected by svgnest.js while CAD-Nest keeps its newer parser.
 */
(function(root){
	'use strict';

	if(!root.SvgParser || !root.SvgParser.load){
		return;
	}

	var load = root.SvgParser.load;
	var lastRoot = null;
	root.SvgParser.load = function(dirpath, svgString, scale, scalingFactor){
		if(arguments.length === 1 && typeof dirpath === 'string'){
			lastRoot = load(null, dirpath, 72, null);
			return lastRoot;
		}
		lastRoot = load(dirpath, svgString, scale, scalingFactor);
		return lastRoot;
	};

	if(!root.SvgParser.getStyle){
		root.SvgParser.getStyle = function(){
			return lastRoot ? lastRoot.querySelector('style') : null;
		};
	}
})(this);
