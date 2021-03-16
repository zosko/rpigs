var http = require('http');
var express = require('express');
const bodyParser = require("body-parser");
var path = require("path");
const SerialPort = require('serialport');
const app = express();

app.use('/',express.static(path.join(__dirname, './')));
app.use(bodyParser.urlencoded({ extended: true }));
app.use(bodyParser.json());

http.createServer(app).listen(8080);

var lastPacket = new Date();
var portConnected = "";
var serialPort = null;

//////////////////////////////
///  SMART PORT VARIABLES  ///
///------------------------///
var lat = 0.0
var lng = 0.0
var alt = 0
var gps_sats = 0
var distance = 0
var speed = 0
var voltage = 0.0
var rssi = 0
var current = 0
var heading = 0
var flight_mode = 0
var fuel = 0
var roll = 0
var pitch = 0

const State = {
    IDLE: 0,
    DATA: 1,
    XOR: 2
}

const PACKET_SIZE = 0x09
const START_BYTE  = 0x7E
const DATA_START  = 0x10
const DATA_STUFF  = 0x7D
const STUFF_MASK  = 0x20

const VFAS_SENSOR  = 0x0210
const CELL_SENSOR  = 0x0910
const VSPEED_SENSOR  = 0x0110
const GSPEED_SENSOR  = 0x0830
const ALT_SENSOR  = 0x0100
const GALT_SENSOR  = 0x0820
const DISTANCE_SENSOR  = 0x0420
const FUEL_SENSOR  = 0x0600
const GPS_SENSOR  = 0x0800
const CURRENT_SENSOR  = 0x200
const HEADING_SENSOR  = 0x0840
const RSSI_SENSOR  = 0xF101
const FLYMODE_SENSOR  = 0x0400
const GPS_STATE_SENSOR  = 0x0410
const PITCH_SENSOR  = 0x0430
const ROLL_SENSOR  = 0x0440
const AIRSPEED_SENSOR  = 0x0A00
const FLIGHT_PATH_VECTOR  = 0x0450
const RX_BAT = 0xF104

var state = State.IDLE
var bufferIndex = 0
var buffer = Buffer.alloc(9);
var newLatitude = false
var newLongitude = false
var latitude = 0.0
var longitude = 0.0
///------------------------///
///  SMART PORT VARIABLES  ///
//////////////////////////////

///////////////////////////
///  TRACKER VARIABLES  ///
///--------------------////
var homeCoordinate = { lat:0, lng:0 }
var planeCoordinate = { lat:0, lng:0 }
var fakeNorthCoordinate = { lat:0, lng:0 }
var homeFix = false
///--------------------////
///  TRACKER VARIABLES  ///
///////////////////////////

//////////////////////
///    WEB API     ///
///---------------////
app.get('/', function (req, res) {
	res.sendFile(path.join(__dirname + '/index.html'));  
})
app.get('/disconnect', function (req, res) {
    serialPort.close();
    homeFix = false;

    homeCoordinate.lat = 0
    homeCoordinate.lng = 0

    planeCoordinate.lat = 0
    planeCoordinate.lng = 0

    fakeNorthCoordinate.lat = 0
    fakeNorthCoordinate.lng = 0

    res.send("");
})
app.post('/connect', function (req, res) {
    portConnected = req.body.port;
    connect()
	res.send("");
})
app.get('/ports', function (req, res) {
	SerialPort.list().then(function(ports){
        res.send(JSON.stringify(ports));
    });
})
app.get('/flight', function (req, res) {
    if (serialPort == null){
        lastPacket = new Date();
        res.send(JSON.stringify({}));
        return;
    }

    const last_packet = parseInt(Math.abs(new Date() - lastPacket) / 1000);

    if (last_packet > 25){
        lastPacket = new Date();
        reconnect();
    }

    if (gps_sats > 5 && !homeFix){
        homeFix = true
        homeCoordinate.lat = lat
        homeCoordinate.lng = lng
    }

    planeCoordinate.lat = lat
    planeCoordinate.lng = lng

	var flight = {
		plane:planeCoordinate,
		alt:alt,
		gps_sats:gps_sats,
		distance:distance,
		speed:speed,
		voltage:voltage,
		rssi:rssi,
		current:current,
		heading:heading,
		arm:getArmed(),
		stabilization:getStabilization(),
		fuel:fuel,
		roll:roll,
		pitch:pitch,
        last_packet:last_packet,
        home:homeCoordinate
	}
    res.send(JSON.stringify(flight));
})
app.get('/fake_north', function (req, res) {
    if (homeFix){
        fakeNorthCoordinate.lat = lat
        fakeNorthCoordinate.lng = lng
        res.send(JSON.stringify("SET"));
    }
    else{
        res.send(JSON.stringify("INVALID"));
    }
})
app.get('/tracker', function (req, res) {

    var fakeAngleNorth = angleBetweenCoordinates(homeCoordinate, fakeNorthCoordinate)
    var angle = angleBetweenCoordinates(homeCoordinate, planeCoordinate, fakeAngleNorth)
    var distance = calculateDistance(homeCoordinate, planeCoordinate)
    var elevation = elevationAngle(homeCoordinate, planeCoordinate, alt)
    var servo = panAngle(angle)
        
    res.send(JSON.stringify("[angle]" + angle +"[servo]" + servo + "[distance]" + distance+"[elevation]"+ elevation));
})
///---------------////
///    WEB API     ///
//////////////////////

///////////////////////////////
///  SERIAL PORT FUNCTIONS  ///
///-------------------------///
function connect(){
    serialPort = new SerialPort(portConnected, { baudRate: 57600 });

    serialPort.on("open", () => {
        console.log('SerialPort: ' + portConnected);
    });
    serialPort.on('error', function(err) {
        console.log('Error: ', err.message)
    });
    serialPort.on('data', data =>{
        process_incoming_bytes(data);
    });

    setTimeout(function() {
        serialPort.write('AT+PIN000000\r\n');
    }, 1000);
    setTimeout(function() {
        serialPort.write('AT+CONA4C249839091C\r\n');
    }, 2000);
}
function reconnect(){
    serialPort.close();
    connect()
}
///-------------------------///
///  SERIAL PORT FUNCTIONS  ///
///////////////////////////////

/////////////////////////////
/// SMART PORT FUNCTIONS  ///
///-----------------------///
function getStabilization(){
    var mode = parseInt(flight_mode / 10 % 10);
    if (mode == 2){
        return "horizon"
    }
    else if (mode == 1) {
        return "angle"
    }
    else{
        return "manual"
    }
}
function getArmed(){
    var mode = parseInt(flight_mode % 10);
    if (mode == 5) {
        return "YES"
    }
    return "NO"
}
function buffer_get_int16(buffer,index){
    return buffer[index] << 8 | buffer[index - 1]
}
function buffer_get_int32(buffer, index) {
    return buffer[index] << 24 | buffer[index - 1] << 16 | buffer[index - 2] << 8 | buffer[index - 3]
}
function process_incoming_bytes(incomingData){
    const data = Buffer.from(incomingData);
    for (var i = 0; i < data.length; i++) {
        switch (state) {
            case State.IDLE:
                if (data[i] == START_BYTE) {
                    state = State.DATA
                    bufferIndex = 0
                }
            break
            case State.DATA:
                if (data[i] == DATA_STUFF) {
                    state = State.XOR
                }
                else if (data[i] == START_BYTE) {
                    bufferIndex = 0
                }
                else{
                    buffer[bufferIndex] = data[i]
                    bufferIndex += 1
                }
            break
            case State.XOR:
                buffer[bufferIndex] = data[i] ^ STUFF_MASK
                bufferIndex += 1
                state = State.DATA
            break
        }
        
        if (bufferIndex == PACKET_SIZE) {
            state = State.IDLE
            var _ = buffer[0] //sensor type
            var packetType = buffer[1]
            if (packetType == DATA_START) {
                lastPacket = new Date();
                
                var dataType = buffer_get_int16(buffer,3);
                var rawData = buffer_get_int32(buffer,7);
                //console.log(dataType.toString(16));
                switch (dataType) {
                    case VFAS_SENSOR:
                        voltage = parseFloat(rawData) / 100.0
                    break
                    case GSPEED_SENSOR:
                        speed = parseInt((parseFloat(rawData) / (1944.0 / 100.0)) / 27.778)
                    break
                    case GALT_SENSOR:
                        alt = parseInt(parseFloat(rawData) / 100.0)
                    break
                    case DISTANCE_SENSOR:
                        distance = parseInt(rawData)
                    break
                    case FUEL_SENSOR:
                        fuel = parseInt(rawData)
                    break
                    case GPS_SENSOR:
                        var gpsData = parseFloat((rawData & 0x3FFFFFFF)) / 10000.0 / 60.0
                        if (rawData & 0x40000000 > 0) {
                            gpsData = -gpsData
                        }
                        if (parseInt(rawData) & parseInt(0x80000000) == 0) {
                            newLatitude = true
                            latitude = gpsData
                        } else {
                            newLongitude = true
                            longitude = gpsData
                        }
                        if (newLatitude && newLongitude) {
                            newLongitude = false
                            newLatitude = false
                            lat = latitude
                            lng = longitude
                        }
                    break
                    case CURRENT_SENSOR:
                        current = parseInt(parseFloat(rawData) / 10.0)
                    break
                    case HEADING_SENSOR:
                        heading = parseInt(parseFloat(rawData) / 100.0)
                    break
                    case RSSI_SENSOR:
                        rssi = parseInt(rawData)
                    break
                    case FLYMODE_SENSOR:
                        flight_mode = parseInt(rawData)
                    break
                    case GPS_STATE_SENSOR:
                        gps_sats = parseInt(rawData % 100)
                    break
                    case PITCH_SENSOR:
                        pitch = parseInt(parseFloat(rawData) / 10.0)
                    break
                    case ROLL_SENSOR:
                        roll = parseInt(parseFloat(rawData) / 10.0)
                    break
                    default:
                    break
                }
            }
        }
    }
}
///-----------------------///
/// SMART PORT FUNCTIONS  ///
/////////////////////////////

////////////////////////////
///   TRACKER FUNCTIONS  ///
///----------------------///
function calculateDistance(point1, point2){
    var delta = deg2rad(point1.lng - point2.lng)
    var sdlong = Math.sin(delta)
    var cdlong = Math.cos(delta)
    var lat1 = deg2rad(point1.lat)
    var lat2 = deg2rad(point2.lat)
    var slat1 = Math.sin(lat1)
    var clat1 = Math.cos(lat1)
    var slat2 = Math.sin(lat2)
    var clat2 = Math.cos(lat2)

    delta = (clat1 * slat2) - (slat1 * clat2 * cdlong)
    delta = delta * delta
    delta += (clat2 * sdlong) * (clat2 * sdlong)
    delta = Math.sqrt(delta)

    var denom = (slat1 * slat2) + (clat1 * clat2 * cdlong)
    delta = Math.atan2(delta, denom)
    return delta * 6372795
}
function elevationAngle(point1, point2, altitude) {
    var distance = calculateDistance(point1,point2)
    var at = Math.atan2(altitude, distance);
    at = at * 57.2957795 // 1 radian == 57.2957795 angle
    return at
}
function angleBetweenCoordinates(point1, point2, fakeNorth = 0) {
    var deltaX = point2.lat - point1.lat
    var deltaY = point2.lng - point1.lng
    var atan = Math.atan2(deltaY, deltaX)
    var degree = rad2deg(atan)
    var angle = (degree < 0) ? (360 + degree) : degree
        
    if (angle >= fakeNorth) {
        angle = angle - fakeNorth
    }
    else {
        angle = angle + (360 - fakeNorth)
    }
    return angle
}
function deg2rad(number) {
    return number * Math.PI / 180
}
function rad2deg(number) {
    return number * 180 / Math.PI
}
function panAngle(angle){
    var panAngle = 0
        
    if (angle >= 270 && angle <= 360) {
        panAngle = angle - 270
    }
    if (angle >= 0 && angle <= 90) {
        panAngle = angle + 90
    }
    return panAngle
}
///----------------------///
///   TRACKER FUNCTIONS  ///
////////////////////////////
