//http://alteredqualia.com/three/examples/webgl_road.html

var camera, scene, renderer;
var cityTile;
var container;
var MARGIN = 100;
var SCREEN_WIDTH = window.innerWidth;
var SCREEN_HEIGHT = window.innerHeight - 2 * MARGIN;
var POSTPROCESS = true;
var FOG_NEAR = 20, FAR = 400;

function init() {
  container = document.createElement('div');
  document.body.appendChild(container);
  scene = new THREE.Scene();
  camera = new THREE.OrthographicCamera(
      window.innerWidth / -2,
      window.innerWidth / 2,
      window.innerHeight / 2,
      window.innerHeight / -2,
      0.1,
      3000
  );
  scene.add( camera );
  scene.fog = new THREE.Fog( 0xffffff, FOG_NEAR, FAR );

  var mapStrips = THREE.ImageUtils.loadTexture( "stripes.png" );
	mapStrips.wrapS = mapStrips.wrapT = THREE.RepeatWrapping;
	mapStrips.magFilter = THREE.NearestFilter;
	mapStrips.repeat.set( 1, 512 );

  var materialRoad = new THREE.MeshPhongMaterial( { color: 0x222222, ambient: 0x222222, specular: 0x222222, perPixel: true } );

	var materialCenter = new THREE.MeshPhongMaterial( { color: 0xffee00, ambient: 0xffee00, specular: 0xffee00, map: mapStrips, perPixel: true, alphaTest: 0.5 } );
	materialCenter.polygonOffset = true;
	materialCenter.polygonOffsetFactor = -1;
	materialCenter.polygonOffsetUnits = 1;

	var materialFront = new THREE.MeshBasicMaterial( { color: 0xffee00 } );
	materialFront.polygonOffset = true;
	materialFront.polygonOffsetFactor = -1;
	materialFront.polygonOffsetUnits = 1;

	var materialBack = new THREE.MeshBasicMaterial( { color: 0xff0000 } );
	materialBack.polygonOffset = true;
	materialBack.polygonOffsetFactor = -1;
	materialBack.polygonOffsetUnits = 1;

  var materialGround = new THREE.MeshPhongMaterial( { color: 0xaaaaaa, ambient: 0xaaaaaa, specular: 0x999999, perPixel: true, vertexColors: THREE.FaceColors } );

  var sharedMaterials = {

					ground: materialGround,
					road: materialRoad,
					center: materialCenter,
					front: materialFront,
					back: materialBack

	};
  var parametersShort = {

					ROAD_LENGTH: 500,

					CENTER_WIDTH: 0.125,
					ROAD_WIDTH: 15,

					CURB_WIDTH:  0.25,
					CURB_HEIGHT: 0.15,

					DELINEATOR_WIDTH: 0.1,
					DELINEATOR_HEIGHT: 0.9,

					SIDEWALK_WIDTH: 4,
					SIDEROAD_WIDTH: 2,

					GROUND_WIDTH: 150,

					LAMP_HEIGHT: 4.5,
					LAMP_BOTTOM: 0.5,

					NUM_BUILDINGS: 100

	};

  cityTile = generateTile( "city", parametersShort, sharedMaterials );
  cityTile.position.y = -2.5;
  scene.add( cityTile );
  // renderer

  renderer = new THREE.WebGLRenderer( { alpha: false, antialias: !POSTPROCESS } );
  renderer.setSize( SCREEN_WIDTH, SCREEN_HEIGHT );
  renderer.setClearColor( scene.fog.color, 1 );

  renderer.domElement.style.position = "absolute";
  renderer.domElement.style.top = MARGIN + "px";
  renderer.domElement.style.left = "0px";

  container.appendChild( renderer.domElement );
}


function render() {
	requestAnimationFrame( render );
	renderer.render( scene, camera );
}

init();
render();

function addStatic( parent, child ) {

	child.matrixAutoUpdate = false;
	child.updateMatrix();

	parent.add( child );

}

function generateTile( tileType, parameters, materials ) {
				var tileRoot = new THREE.Object3D();

				// road

				var road = generateRoad( parameters.ROAD_LENGTH, parameters.ROAD_WIDTH, parameters.CENTER_WIDTH, materials.road, materials.center );
				tileRoot.add( road );


				return tileRoot;

}

function generateRoad ( roadLength, roadWidth, centerWidth, materialRoad, materialCenter ) {

		var root = new THREE.Object3D();
		root.rotation.x = -Math.PI/2;

		var groundGeo = new THREE.PlaneGeometry( roadWidth, roadLength );
		var centerGeo = new THREE.PlaneGeometry( centerWidth, roadLength );

		var ground = new THREE.Mesh( groundGeo, materialRoad );
		var center = new THREE.Mesh( centerGeo, materialCenter );

		ground.receiveShadow = true;
		center.receiveShadow = true;

		addStatic( root, ground );
		addStatic( root, center );

		return root;

}
