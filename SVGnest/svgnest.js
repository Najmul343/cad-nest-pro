/*!
 * SvgNest
 * Licensed under the MIT license
 */
 
(function(root){
	'use strict';

	root.SvgNest = new SvgNest();
	
	function SvgNest(){
		var self = this;
		
		var svg = null;
		
		// keep a reference to any style nodes, to maintain color/fill info
		this.style = null;
		
		var parts = null;
		
		var tree = null;
		
		
		var bin = null;
		var binPolygon = null;
		var binBounds = null;
		var nfpCache = {};
		var config = {
			clipperScale: 10000000,
			curveTolerance: 0.3, 
			spacing: 0,
			rotations: 4,
			populationSize: 10,
			mutationRate: 10,
			useHoles: false,
			exploreConcave: false
		};
		
		this.working = false;
		
		var GA = null;
		var best = null;
		var workerTimer = null;
		var progress = 0;
		
		this.parsesvg = function(svgstring){
			// reset if in progress
			this.stop();
			
			bin = null;
			binPolygon = null;
			tree = null;
			
			// parse svg
			svg = SvgParser.load(svgstring);
			
			this.style = SvgParser.getStyle();

			svg = SvgParser.clean();
			
			tree = this.getParts(svg.childNodes);

			//re-order elements such that deeper elements are on top, so they can be moused over
			function zorder(paths){
				// depth-first
				var length = paths.length;
				for(var i=0; i<length; i++){
					if(paths[i].children && paths[i].children.length > 0){
						zorder(paths[i].children);
					}
				}
			}
			
			return svg;
		}
		
		this.setbin = function(element){
			if(!svg){
				return;
			}
			bin = element;
		}
		
		this.config = function(c){
			// clean up inputs
			
			if(!c){
				return config;
			}
			
			if(c.curveTolerance && !GeometryUtil.almostEqual(parseFloat(c.curveTolerance), 0)){
				config.curveTolerance =  parseFloat(c.curveTolerance);
			}
			
			if('spacing' in c){
				config.spacing = parseFloat(c.spacing);
			}
			
			if(c.rotations && parseInt(c.rotations) > 0){
				config.rotations = parseInt(c.rotations);
			}
			
			if(c.populationSize && parseInt(c.populationSize) > 2){
				config.populationSize = parseInt(c.populationSize);
			}
			
			if(c.mutationRate && parseInt(c.mutationRate) > 0){
				config.mutationRate = parseInt(c.mutationRate);
			}
			
			if('useHoles' in c){
				config.useHoles = !!c.useHoles;
			}
			
			if('exploreConcave' in c){
				config.exploreConcave = !!c.exploreConcave;
			}
			
			SvgParser.config({ tolerance: config.curveTolerance});
			
			best = null;
			nfpCache = {};
			binPolygon = null;
			GA = null;
						
			return config;
		}
		
		// progressCallback is called when progress is made
		// displayCallback is called when a new placement has been made
		this.start = function(progressCallback, displayCallback){						
			if(!svg || !bin){
				return false;
			}
			
			parts = Array.prototype.slice.call(svg.childNodes);
			var binindex = parts.indexOf(bin);
			
			if(binindex >= 0){
				// don't process bin as a part of the tree
				parts.splice(binindex, 1);
			}
			
			// build tree without bin
			tree = this.getParts(parts.slice(0));
			
			offsetTree(tree, 0.5*config.spacing, this.polygonOffset.bind(this));

			// offset tree recursively
			function offsetTree(t, offset, offsetFunction){
				for(var i=0; i<t.length; i++){
					var offsetpaths = offsetFunction(t[i], offset);
					if(offsetpaths.length == 1){
						// replace array items in place
						Array.prototype.splice.apply(t[i], [0, t[i].length].concat(offsetpaths[0]));
					}
					
					if(t[i].childNodes && t[i].childNodes.length > 0){
						offsetTree(t[i].childNodes, -offset, offsetFunction);
					}
				}
			}
			
			binPolygon = SvgParser.polygonify(bin);
			binPolygon = this.cleanPolygon(binPolygon);
						
			if(!binPolygon || binPolygon.length < 3){
				return false;
			}
			
			binBounds = GeometryUtil.getPolygonBounds(binPolygon);
						
			if(config.spacing > 0){
				var offsetBin = this.polygonOffset(binPolygon, -0.5*config.spacing);
				if(offsetBin.length == 1){
					// if the offset contains 0 or more than 1 path, something went wrong.
					binPolygon = offsetBin.pop();
				}
			}
						
			binPolygon.id = -1;
			
			// put bin on origin
			var xbinmax = binPolygon[0].x;
			var xbinmin = binPolygon[0].x;
			var ybinmax = binPolygon[0].y;
			var ybinmin = binPolygon[0].y;
			
			for(var i=1; i<binPolygon.length; i++){
				if(binPolygon[i].x > xbinmax){
					xbinmax = binPolygon[i].x;
				}
				else if(binPolygon[i].x < xbinmin){
					xbinmin = binPolygon[i].x;
				}
				if(binPolygon[i].y > ybinmax){
					ybinmax = binPolygon[i].y;
				}
				else if(binPolygon[i].y < ybinmin){
					ybinmin = binPolygon[i].y;
				}
			}
			
			for(i=0; i<binPolygon.length; i++){
				binPolygon[i].x -= xbinmin;
				binPolygon[i].y -= ybinmin;
			}
			
			binPolygon.width = xbinmax-xbinmin;
			binPolygon.height = ybinmax-ybinmin;
			
			// all paths need to have the same winding direction
			if(GeometryUtil.polygonArea(binPolygon) > 0){
				binPolygon.reverse();
			}
			
			// remove duplicate endpoints, ensure counterclockwise winding direction
			for(i=0; i<tree.length; i++){
				var start = tree[i][0];
				var end = tree[i][tree[i].length-1];
				if(start == end || (GeometryUtil.almostEqual(start.x,end.x) && GeometryUtil.almostEqual(start.y,end.y))){
					tree[i].pop();
				}
				
				if(GeometryUtil.polygonArea(tree[i]) > 0){
					tree[i].reverse();
				}
			}
			
			var binArea = Math.abs(GeometryUtil.polygonArea(binPolygon));
			for(i=0; i<tree.length; i++){
				if(Math.abs(GeometryUtil.polygonArea(tree[i])) > binArea){
					alert("A selected part is larger than the bin. The bigger piece cannot be fitted inside the smaller bin.");
					return false;
				}
			}
			
			var self = this;
			this.working = false;
			
			workerTimer = setInterval(function(){
				if(!self.working){
					self.launchWorkers.call(self, tree, binPolygon, config, progressCallback, displayCallback);
					self.working = true;
				}
				
				progressCallback(progress);
			}, 100);
		}
		
		this.launchWorkers = function(tree, binPolygon, config, progressCallback, displayCallback){
			var self = this;
			
			// Call the high-speed backend API instead of freezing the browser!
			fetch('/api/nest', {
				method: 'POST',
				headers: {
					'Content-Type': 'application/json'
				},
				body: JSON.stringify({
					tree: tree,
					binPolygon: binPolygon,
					config: config
				})
			})
			.then(response => response.json())
			.then(data => {
				self.working = false;
				if (data && data.placements) {
					displayCallback(data.placements, 1);
				}
			})
			.catch(err => {
				console.error("Backend nesting error:", err);
				self.working = false;
			});
		};

		// assuming no intersections, return a tree where odd leaves are parts and even ones are holes
		// might be easier to use the DOM, but paths can't have paths as children. So we'll just make our own tree.
		this.getParts = function(paths){
			
			var i, j;
			var polygons = [];
			
			var numChildren = paths.length;
			for(i=0; i<numChildren; i++){
				var poly = SvgParser.polygonify(paths[i]);
				poly = this.cleanPolygon(poly);
				
				// todo: warn user if poly could not be processed and is excluded from the nest
				if(poly && poly.length > 2 && Math.abs(GeometryUtil.polygonArea(poly)) > config.curveTolerance*config.curveTolerance){
					poly.source = i;					
					polygons.push(poly);
				}
			}
						
			// turn the list into a tree
			toTree(polygons);
			
			function toTree(list, idstart){
				var parents = [];
				var i,j;
				
				// assign a unique id to each leaf
				var id = idstart || 0;
				
				for(i=0; i<list.length; i++){
					var p = list[i];
					
					var ischild = false;
					for(j=0; j<list.length; j++){
						if(j==i){
							continue;
						}
						if(GeometryUtil.pointInPolygon(p[0], list[j]) === true){
							if(!list[j].children){
								list[j].children = [];
							}
							list[j].children.push(p);
							p.parent = list[j];
							ischild = true;
							break;
						}
					}
					
					if(!ischild){
						parents.push(p);
					}
				}
				
				for(i=0; i<list.length; i++){
					if(parents.indexOf(list[i]) < 0){
						list.splice(i, 1);
						i--;
					}
				}
				
				for(i=0; i<parents.length; i++){
					parents[i].id = id;
					id++;
				}
				
				for(i=0; i<parents.length; i++){
					if(parents[i].children){
						id = toTree(parents[i].children, id);
					}
				}
								
				return id;
			};
			
			return polygons;
		};
		
		// use the clipper library to return an offset to the given polygon. Positive offset expands the polygon, negative contracts
		// note that this returns an array of polygons
		this.polygonOffset = function(polygon, offset){
			if(!offset || offset == 0 || GeometryUtil.almostEqual(offset, 0)){
				return polygon;
			}
			
			var p = this.svgToClipper(polygon);
			
			var miterLimit = 2;
			var co = new ClipperLib.ClipperOffset(miterLimit, config.curveTolerance*config.clipperScale);
			co.AddPath(p, ClipperLib.JoinType.jtRound, ClipperLib.EndType.etClosedPolygon);
			
			var newpaths = new ClipperLib.Paths();
			co.Execute(newpaths, offset*config.clipperScale);
						
			var result = [];
			for(var i=0; i<newpaths.length; i++){
				result.push(this.clipperToSvg(newpaths[i]));
			}
			
			return result;
		};
		
		// returns a less complex polygon that satisfies the curve tolerance
		this.cleanPolygon = function(polygon){
			var p = this.svgToClipper(polygon);
			// remove self-intersections and find the biggest polygon that's left
			var simple = ClipperLib.Clipper.SimplifyPolygon(p, ClipperLib.PolyFillType.pftNonZero);
			
			if(!simple || simple.length == 0){
				return null;
			}
			
			var biggest = simple[0];
			var biggestarea = Math.abs(ClipperLib.Clipper.Area(biggest));
			for(var i=1; i<simple.length; i++){
				var area = Math.abs(ClipperLib.Clipper.Area(simple[i]));
				if(area > biggestarea){
					biggest = simple[i];
					biggestarea = area;
				}
			}

			// clean up singularities, coincident points and edges
			var clean = ClipperLib.Clipper.CleanPolygon(biggest, config.curveTolerance*config.clipperScale);
						
			if(!clean || clean.length == 0){
				return null;
			}
						
			return this.clipperToSvg(clean);
		}
		
		// converts a polygon from normal float coordinates to integer coordinates used by clipper, as well as x/y -> X/Y
		this.svgToClipper = function(polygon){
			var clip = [];
			for(var i=0; i<polygon.length; i++){
				clip.push({X: polygon[i].x, Y: polygon[i].y});
			}
			
			ClipperLib.JS.ScaleUpPath(clip, config.clipperScale);
			
			return clip;
		}
		
		this.clipperToSvg = function(polygon){
			var normal = [];
			
			for(var i=0; i<polygon.length; i++){
				normal.push({x: polygon[i].X/config.clipperScale, y: polygon[i].Y/config.clipperScale});
			}
			
			return normal;
		}
		
		// returns an array of SVG elements that represent the placement, for export or rendering
		this.applyPlacement = function(placement){
			var i, j, k;
			var clone = [];
			for(i=0; i<parts.length; i++){
				clone.push(parts[i].cloneNode(false));
			}
			
			var svglist = [];

			for(i=0; i<placement.length; i++){
				var newsvg = svg.cloneNode(false);
				newsvg.setAttribute('viewBox', '0 0 '+binBounds.width+' '+binBounds.height);
				newsvg.setAttribute('width',binBounds.width + 'px');
				newsvg.setAttribute('height',binBounds.height + 'px');
				var binclone = bin.cloneNode(false);
				
				binclone.setAttribute('class','bin');
				binclone.setAttribute('transform','translate('+(-binBounds.x)+' '+(-binBounds.y)+')');
				newsvg.appendChild(binclone);

				for(j=0; j<placement[i].length; j++){
					var p = placement[i][j];
					var part = tree[p.id];
					
					// the original path could have transforms and stuff on it, so apply our transforms on a group
					var partgroup = document.createElementNS(svg.namespaceURI, 'g');
					partgroup.setAttribute('transform','translate('+p.x+' '+p.y+') rotate('+p.rotation+')');
					partgroup.appendChild(clone[part.source]);
					
					if(part.children && part.children.length > 0){
						var flattened = _flattenTree(part.children, true);
						for(k=0; k<flattened.length; k++){
							
							var c = clone[flattened[k].source];
							// add class to indicate hole
							if(flattened[k].hole && (!c.getAttribute('class') || c.getAttribute('class').indexOf('hole') < 0)){
								c.setAttribute('class',c.getAttribute('class')+' hole');
							}
							partgroup.appendChild(c);
						}
					}
					
					newsvg.appendChild(partgroup);
				}
				
				svglist.push(newsvg);
			}
			
			// flatten the given tree into a list
			function _flattenTree(t, hole){
				var flat = [];
				for(var i=0; i<t.length; i++){
					flat.push(t[i]);
					t[i].hole = hole;
					if(t[i].children && t[i].children.length > 0){
						flat = flat.concat(_flattenTree(t[i].children, !hole));
					}
				}
				
				return flat;
			}
			
			return svglist;
		}
		
		this.stop = function(){
			this.working = false;
			if(workerTimer){
				clearInterval(workerTimer);
			}
		};
	}
	
	function GeneticAlgorithm(adam, bin, config){
	
		this.config = config || { populationSize: 10, mutationRate: 10, rotations: 4 };
		this.binBounds = GeometryUtil.getPolygonBounds(bin);
		
		// population is an array of individuals. Each individual is a object representing the order of insertion and the angle each part is rotated
		var angles = [];
		for(var i=0; i<adam.length; i++){
			angles.push(this.randomAngle(adam[i]));
		}
		
		this.population = [{placement: adam, rotation: angles}];
		
		while(this.population.length < config.populationSize){
			var mutant = this.mutate(this.population[0]);
			this.population.push(mutant);
		}
	}
	
	// returns a random angle of insertion
	GeneticAlgorithm.prototype.randomAngle = function(part){
		
		var angleList = [];
		for(var i=0; i<Math.max(this.config.rotations,1); i++){
			angleList.push(i*(360/this.config.rotations));
		}
		
		function shuffleArray(array) {
			for (var i = array.length - 1; i > 0; i--) {
				var j = Math.floor(Math.random() * (i + 1));
				var temp = array[i];
				array[i] = array[j];
				array[j] = temp;
			}
			return array;
		}
		
		angleList = shuffleArray(angleList);

		for(i=0; i<angleList.length; i++){
			var rotatedPart = GeometryUtil.rotatePolygon(part, angleList[i]);
			
			// don't use obviously bad angles where the part doesn't fit in the bin
			if(rotatedPart.width < this.binBounds.width && rotatedPart.height < this.binBounds.height){
				return angleList[i];
			}
		}
		
		return 0;
	}
	
	// returns a mutated individual with the given mutation rate
	GeneticAlgorithm.prototype.mutate = function(individual){
		var clone = {placement: individual.placement.slice(0), rotation: individual.rotation.slice(0)};
		for(var i=0; i<clone.placement.length; i++){
			var rand = Math.random();
			if(rand < 0.01*this.config.mutationRate){
				// swap current part with next part
				var j = i+1;
				
				if(j < clone.placement.length){
					var temp = clone.placement[i];
					clone.placement[i] = clone.placement[j];
					clone.placement[j] = temp;
				}
			}
			
			rand = Math.random();
			if(rand < 0.01*this.config.mutationRate){
				clone.rotation[i] = this.randomAngle(clone.placement[i]);
			}
		}
		
		return clone;
	}
	
	// single point crossover
	GeneticAlgorithm.prototype.mate = function(male, female){
		var cutpoint = Math.round(Math.min(Math.max(Math.random(), 0.1), 0.9)*(male.placement.length-1));
		
		var gene1 = male.placement.slice(0,cutpoint);
		var rot1 = male.rotation.slice(0,cutpoint);
		
		var gene2 = female.placement.slice(0,cutpoint);
		var rot2 = female.rotation.slice(0,cutpoint);
		
		var i;
		
		for(i=0; i<female.placement.length; i++){
			if(!contains(gene1, female.placement[i].id)){
				gene1.push(female.placement[i]);
				rot1.push(female.rotation[i]);
			}
		}
		
		for(i=0; i<male.placement.length; i++){
			if(!contains(gene2, male.placement[i].id)){
				gene2.push(male.placement[i]);
				rot2.push(male.rotation[i]);
			}
		}
		
		function contains(gene, id){
			for(var i=0; i<gene.length; i++){
				if(gene[i].id == id){
					return true;
				}
			}
			return false;
		}
		
		return [{placement: gene1, rotation: rot1},{placement: gene2, rotation: rot2}];
	}

	GeneticAlgorithm.prototype.generation = function(){
				
		// Individuals with higher fitness are more likely to be selected for mating
		this.population.sort(function(a, b){
			return a.fitness - b.fitness;
		});
		
		// fittest individual is preserved in the new generation (elitism)
		var newpopulation = [this.population[0]];
		
		while(newpopulation.length < this.population.length){
			var male = this.randomWeightedIndividual();
			var female = this.randomWeightedIndividual(male);
			
			// each mating produces two children
			var children = this.mate(male, female);
			
			// slightly mutate children
			newpopulation.push(this.mutate(children[0]));
				
			if(newpopulation.length < this.population.length){
				newpopulation.push(this.mutate(children[1]));
			}
		}
				
		this.population = newpopulation;
	}
	
	// returns a random individual from the population, weighted to the front of the list (lower fitness value is more likely to be selected)
	GeneticAlgorithm.prototype.randomWeightedIndividual = function(exclude){
		var pop = this.population.slice(0);
		
		if(exclude && pop.indexOf(exclude) >= 0){
			pop.splice(pop.indexOf(exclude),1);
		}
		
		var rand = Math.random();
		
		var lower = 0;
		var weight = 1/pop.length;
		var upper = weight;
		
		for(var i=0; i<pop.length; i++){
			// if the random number falls between lower and upper bounds, select this individual
			if(rand > lower && rand < upper){
				return pop[i];
			}
			lower = upper;
			upper += 2*weight * ((pop.length-i)/pop.length);
		}
		
		return pop[0];
	}
	
})(window);
