var http = require('http');
var Canvas = require('canvas');
var sheetengine = require('../sheetengine');

// setup canvas creating method: we'll use node-canvas objects instead of <canvas> elements
sheetengine.drawing.createCanvas = function(w, h) { return new Canvas(w, h); };

function drawScene() {

  var canvasElement = new Canvas(900,500);
  sheetengine.scene.init(canvasElement);
  
  // define some basesheets
  for (var x=-1; x<=1; x++) {
    for (var y=-1; y<=1; y++) {
      var basesheet = new sheetengine.BaseSheet({x:x*200,y:y*200,z:0}, {alphaD:90,betaD:0,gammaD:0}, {w:200,h:200});
      basesheet.color = '#5D7E36';
    }
  }
  
  // define some sheets: create a white box
  var sheet1 = new sheetengine.Sheet({x:150,y:20,z:20}, {alphaD:0,betaD:0,gammaD:0}, {w:40,h:40});
  sheet1.context.fillStyle = '#FFF';
  sheet1.context.fillRect(0,0,40,40);

  var sheet2 = new sheetengine.Sheet({x:170,y:0,z:20}, {alphaD:0,betaD:0,gammaD:90}, {w:40,h:40});
  sheet2.context.fillStyle = '#FFF';
  sheet2.context.fillRect(0,0,40,40);

  var sheet3 = new sheetengine.Sheet({x:150,y:0,z:40}, {alphaD:90,betaD:0,gammaD:0}, {w:40,h:40});
  sheet3.context.fillStyle = '#FFF';
  sheet3.context.fillRect(0,0,40,40);
  
  
  // define some sheets: create a pine tree
  var sheet4 = new sheetengine.Sheet({x:-150,y:-120,z:40}, {alphaD:0,betaD:0,gammaD:0}, {w:80,h:80});
  var sheet5 = new sheetengine.Sheet({x:-150,y:-120,z:40}, {alphaD:0,betaD:0,gammaD:90}, {w:80,h:80});
  
  function drawPineTexture(context) {
    context.fillStyle='#BDFF70';
    context.beginPath();
    context.moveTo(40,0);
    context.lineTo(60,30);
    context.lineTo(50,30);
    context.lineTo(70,60);
    context.lineTo(10,60);
    context.lineTo(30,30);
    context.lineTo(20,30);
    context.fill();
    context.fillStyle='#725538';
    context.fillRect(35,60,10,20);
  }
  
  drawPineTexture(sheet4.context);
  drawPineTexture(sheet5.context);
  
  sheetengine.calc.calculateAllSheets();
  sheetengine.drawing.drawScene(true);
}

http.createServer(function (req, res) {

  // redraw the scene for every request
  drawScene();
  
  // send the image as the response
  var buf = sheetengine.canvas.toBuffer();
  
  res.statusCode = 200;
  res.setHeader('Content-Type', 'image/png');
  res.setHeader('Content-Length', buf.length);
  res.end(buf);
  
}).listen(80);

console.log('sheetengine example listening on port 80...');
