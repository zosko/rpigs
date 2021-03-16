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

app.get('/', function (req, res) {
	res.sendFile(path.join(__dirname + '/index.html'));  
})
app.get('/disconnect', function (req, res) {
    serialPort.close();
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

	var flight = {
		lat:lat,
		lng:lng,
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
        last_packet:last_packet
	}
    res.send(JSON.stringify(flight));
})

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

// func calculateDistance(point1 : CGPoint , point2 : CGPoint) -> Int{
//         // returns distance in meters between two positions, both specified
//         // as signed decimal-degrees latitude and longitude. Uses great-circle
//         // distance computation for hypothetical sphere of radius 6372795 meters.
//         // Because Earth is no exact sphere, rounding errors may be up to 0.5%.
//         // Courtesy of Maarten Lamers
//         var delta = deg2rad(Double(point1.y - point2.y))
//         let sdlong = sin(delta)
//         let cdlong = cos(delta)
//         let lat1 = deg2rad(Double(point1.x))
//         let lat2 = deg2rad(Double(point2.x))
//         let slat1 = sin(lat1)
//         let clat1 = cos(lat1)
//         let slat2 = sin(lat2)
//         let clat2 = cos(lat2)
//         delta = (clat1 * slat2) - (slat1 * clat2 * cdlong)
//         delta = delta * delta
//         delta += (clat2 * sdlong) * (clat2 * sdlong)
//         delta = sqrt(delta)
//         let denom = (slat1 * slat2) + (clat1 * clat2 * cdlong)
//         delta = atan2(delta, denom)
//         return Int(delta * 6372795)
//     }
//     func elevationAngle(point1 : CGPoint , point2 : CGPoint, altitude : Int) -> Int {
//         let distance = calculateDistance(point1: point1, point2: point2)
//         var at = atan2(CGFloat(altitude), CGFloat(distance));
//         at = at * 57.2957795 // 1 radian == 57.2957795 angle
//         return Int(at)
//     }
//     func angleBetweenCoordinates(point1 : CGPoint, point2 : CGPoint, fakeNorth : Int = 0) -> Int{
//         let deltaX = point2.x - point1.x
//         let deltaY = point2.y - point1.y
        
//         let atan = atan2(deltaY, deltaX)
//         let degree = rad2deg(Double(atan))
        
//         var angle = Int((degree < 0) ? (360 + degree) : degree)
        
//         if angle >= fakeNorth {
//             angle = angle - fakeNorth
//         }
//         else {
//             angle = angle + (360 - fakeNorth)
//         }
//         return angle
//     }
//     func deg2rad(_ number: Double) -> Double {
//         return number * .pi / 180
//     }
//     func rad2deg(_ number: Double) -> Double {
//         return number * 180 / .pi
//     }
//     func panAngle(angle : Int) -> Int{
//         var panAngle = 0
        
//         if angle >= 270 && angle <= 360 {
//             panAngle = angle - 270
//         }
//         if angle >= 0 && angle <= 90 {
//             panAngle = angle + 90
//         }
//         return panAngle
//     }
// let homePos = CGPoint(x: 42.060012121087816, y: 21.385429952247396)
//         let fakeNorthPos = CGPoint(x: 42.060454231001344, y: 21.384319505905818)
//         let plane = CGPoint(x: 42.06096402093398, y:  21.383455834576207)
        
//         let fakeAngleNorth = angleBetweenCoordinates(point1: homePos, point2: fakeNorthPos)
//         let angle = angleBetweenCoordinates(point1: homePos, point2: plane, fakeNorth: fakeAngleNorth)
//         let distance = calculateDistance(point1: homePos, point2: plane)
//         let elevation = elevationAngle(point1: homePos, point2: plane, altitude: 10)
//         let servo = panAngle(angle: angle)
        
//         print("angle: \(angle)  servo: \(servo) distance: \(distance)m elevation:\(elevation)")
