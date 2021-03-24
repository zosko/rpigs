$(document).ready(function() {
	var connected = checkInternetConnection();

	map = new OpenLayers.Map("map", {
		controls: [
		new OpenLayers.Control.ZoomPanel(),
		new OpenLayers.Control.Navigation()
		]
	});

	if (connected){
		map.addLayer(new OpenLayers.Layer.OSM(
			"OpenStreetMap",
			["https://a.tile.openstreetmap.org/${z}/${x}/${y}.png",
			"https://b.tile.openstreetmap.org/${z}/${x}/${y}.png",
			"https://c.tile.openstreetmap.org/${z}/${x}/${y}.png"]
			));	
	}
	else{
		map.addLayer(new OpenLayers.Layer.OSM("Local Tiles", "tiles/${z}/${x}/${y}.png"));
	}

	epsg4326 =  new OpenLayers.Projection("EPSG:4326");
	projectTo = map.getProjectionObject();
	var markers = new OpenLayers.Layer.Markers("Markers");
	var vectorLayer = new OpenLayers.Layer.Vector("Overlay");
	var zoom = 16;
	var planeMarker = null;
	var homeMarker = null;

	setInterval(function(){ 
		$.get("/flight", function(data, status) {
			var jsonData = JSON.parse(data);
			$('#lat').text(jsonData.plane.lat);
			$('#lng').text(jsonData.plane.lng);
			$('#alt').text(jsonData.alt+"m");
			$('#gps_sats').text(jsonData.gps_sats);
			$('#distance').text(jsonData.distance+"m");
			$('#speed').text(jsonData.speed+"km/h");
			$('#voltage').text(jsonData.voltage+"v");
			$('#rssi').text(jsonData.rssi+"%");
			$('#current').text(jsonData.current+"a");
			$('#arm').text(jsonData.arm);
			$('#stabilization').text(jsonData.stabilization);
			$('#fuel').text(jsonData.fuel+"%");

			$("#heading").css({'transform': 'rotate('+jsonData.heading+'deg)'});
			$("#attitude-horizont").css({top:-jsonData.pitch});
			$("#attitude-plane").css({'transform': 'rotate('+jsonData.roll+'deg)'});
			$('#lastPacket').text(jsonData.last_packet + "s");

			if (planeMarker != null){
				markers.removeMarker(planeMarker);
			}

			if (homeMarker == null){
				if (jsonData.home.lng != 0 && jsonData.home.lat != 0){
					var lonLat = new OpenLayers.LonLat( jsonData.home.lng,jsonData.home.lat).transform(epsg4326, projectTo);
					homeMarker = new OpenLayers.Marker(lonLat);
					markers.addMarker(homeMarker);
					map.addLayer(markers);  
				}
			}

			var lonLat = new OpenLayers.LonLat( jsonData.plane.lng,jsonData.plane.lat ).transform(epsg4326, projectTo);
			planeMarker = new OpenLayers.Marker(lonLat);
			markers.addMarker(planeMarker);
			map.addLayer(markers);

			if ($('#follow').text() === "FREE MAP"){
				map.setCenter (lonLat, zoom);
			}

			if (!$('#fake_north').parent().is(":visible") && $("#fake_north").length) {
				$.get("/tracker", function(data, status) {
					console.log(data);
				});
			}
		});
	}, 300);
	
	$.get("/ports", function(data, status) {
		var jsonData = JSON.parse(data);
		$(jsonData).each(function(index,element) {
			$("#ports").append($("<option />").val(element.path).text(element.path));
		});
	});
	$('#disconnect').on('click', function() {
		$.get("/disconnect", function(data, status) {
			$('.container').addClass('hide');
			$('.ports-wrapper').removeClass('hide');
			$('#fake_north').parent().show();
			homeMarker = null;
			planeMarker = null;
		});
	});
	$('#follow').on('click', function() {
		$(this).text($(this).text()==="FOLLOW MAP" ? "FREE MAP" : "FOLLOW MAP");
	});
	$('#fake_north').on('click', function() {
		$.get("/fake_north", function(data, status) {
			$('#fake_north').parent().hide();
		});
	});
	$('#connect').on('click', function() {
		var selectedPort = $("#ports option:selected").text();
		$.post("/connect/",{port:selectedPort}, function(data, status) {
			$('.container').removeClass('hide');
			$('.ports-wrapper').addClass('hide');
		});
	});
	function checkInternetConnection() {
		var status = navigator.onLine;
		if (status) {
			document.title = 'Ground Station';
			return true;
		} else {
			document.title = 'Ground Station (offline)';
			return false;
		}
	}
});