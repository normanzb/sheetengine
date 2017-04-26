/*
sheetengine v1.2.0
Isometric HTML5 JavaScript Display Engine
sheetengine.codeplex.com

Licensed under the MIT license.
Copyright (C) 2012 Levente Dobson

Permission is hereby granted, free of charge, to any person obtaining a copy of this software and associated documentation files (the "Software"), to deal in the Software without restriction, including without limitation the rights to use, copy, modify, merge, publish, distribute, sublicense, and/or sell copies of the Software, and to permit persons to whom the Software is furnished to do so, subject to the following conditions: 

The above copyright notice and this permission notice shall be included in all copies or substantial portions of the Software. 

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM, OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE SOFTWARE.
*/

var sheetengine = (function() {
  var sheetengine = {
    sheets: [],
    basesheets: [],
    polygons: [],
    objects: [],

    currentSheet: -1,
    hoverSheet: -1,
    
    canvas: null,
    context: null,
    
    canvasCenter: {u:250,v:260},       // main canvas center

    viewSource: { x: -1, y: -1, z: -Math.SQRT1_2 },
  
    tempCanvasSize: {w:115,h:115},     // 115x115: max extent of a 80x80 sheet. the size of the temp canvas used when background is redrawn
    backgroundColor: '#FFF',
    drawObjectContour: false,
    boundingBoxMaxsheetDistance: 150,
  
    objectsintersect: false,
  
    debug: false
  };
  
  var startsheets = [];
  var loadedyards = {};
  var staticsheets = null;

  
  // ===================================================================================================
  // shadows
  var shadows = {};
  sheetengine.shadows = shadows;
  
  shadows.baseshadowCanvas = null;
  shadows.baseshadowContext = null;
  shadows.baseShadowCenter = {u:212,v:2*106};
  shadows.lightSource = { x: 1, y: -3, z: -10 };
  shadows.lightSourcep1 = { x: 1, y: -3, z: 1 };     // perpendicular to lightsource, scalar prod is 0 : 1x -3y -10z = 0
  shadows.lightSourcep2 = { x: -33, y: 11, z: 0 };   // perpendicular both to lightsource and p1 (ls x p1 = p2)
  shadows.shadowAlpha = 0.3;
  shadows.shadeAlpha = 0.3;  // should be the same as shadowalpha, since a shaded sheet counts as if it was in shadow
  shadows.drawShadows = true;
  
  function calculateSheetBaseShadow(sheet) {
    var s = sheet;
    // calculate centerp-p0-p1-p2 crossing with baserect
    // vector of light source
    var l = shadows.lightSource;
    var centerp = { x: s.centerp.x, y: s.centerp.y, z: s.centerp.z }; 
    var p0 = { x: centerp.x + s.p0.x, y: centerp.y + s.p0.y, z: centerp.z + s.p0.z }; 
    var p1 = { x: centerp.x + s.p1.x, y: centerp.y + s.p1.y, z: centerp.z + s.p1.z }; 
    var p2 = { x: centerp.x + s.p2.x, y: centerp.y + s.p2.y, z: centerp.z + s.p2.z }; 

    var tc = centerp.z / -l.z;
    var t0 = p0.z / -l.z;
    var t1 = p1.z / -l.z;
    var t2 = p2.z / -l.z;
    
    var centerpsect = { x: centerp.x + l.x*tc, y: centerp.y + l.y*tc, z: centerp.z + l.z*tc };
    var p0sect = { x: p0.x + l.x*t0 - centerpsect.x, y: p0.y + l.y*t0 - centerpsect.y, z: p0.z + l.z*t0 - centerpsect.z };
    var p1sect = { x: p1.x + l.x*t1 - centerpsect.x, y: p1.y + l.y*t1 - centerpsect.y, z: p1.z + l.z*t1 - centerpsect.z };
    var p2sect = { x: p2.x + l.x*t2 - centerpsect.x, y: p2.y + l.y*t2 - centerpsect.y, z: p2.z + l.z*t2 - centerpsect.z };
    
    // calculate transformation for shadow rectangle
    s.baseShadoweData = calculateSheetDataSingle(centerpsect, p0sect, p1sect, p2sect, transforms.transformPoint, transforms.transformPointz, shadows.baseShadowCenter, s.corners);
  
    s.baseShadoweData.translatex -= scene.center.u;
    s.baseShadoweData.translatey -= scene.center.v;
  };  
  function checkDirtyShadowConstraint(prev, dirtySheets) {
    for (var i=0;i<sheetengine.sheets.length;i++) {
      var sheet = sheetengine.sheets[i];
      
      // dirty sheets will surely be processed later
      if (sheet.dirty)
        continue;
        
      if (sheet.hidden)
        continue;
        
      // initialize sheet's flag in first phase only
      if (prev)
        sheet.shadowdirty = false;
      else 
      {
        // if sheet has already been marked in the first phase, it's canvas will be redrawn anyway
        if (sheet.shadowdirty)
          continue;
      }
        
      for (var j=0;j<sheet.polygons.length; j++) {
        var sheetpoly = sheet.polygons[j];
        var shadowconstraints = prev ? sheetpoly.prevshadowconstraints : sheetpoly.shadowconstraints;
        if (shadowconstraints == null) {
          sheet.shadowdirty = true;
          break;
        }
        for (var k=0;k<shadowconstraints.length;k++) {
          var sheetconstraint = sheetengine.polygons[shadowconstraints[k]].sheetindex;
          if (dirtySheets.indexOf(sheetconstraint) != -1) {
            sheet.shadowdirty = true;
            break;
          }
        }
        if (sheet.shadowdirty)
          break;
      }
    }
  };
  function initBaseRectShadow(ctx, size, rel, viewport) {
    if (!shadows.drawShadows)
      return;

    // clear baserectshadow canvases
    ctx.clearRect(0,0,size.w,size.h);
    
    // draw sheet shadows cast on baserect to baserectcanvases
    for (var i=0;i<sheetengine.sheets.length;i++) {
      var s = sheetengine.sheets[i];
      if (s.hidden)
        continue;
  
    if (!s.castshadows)
      continue;
    
      if (viewport) {
        var sheetdata = s.data;
        if (sheetdata.centerpuv.u < viewport.minu || sheetdata.centerpuv.u > viewport.maxu || sheetdata.centerpuv.v < viewport.minv || sheetdata.centerpuv.v > viewport.maxv)
          continue;
      }
    
      s.baseShadoweData.translatex += rel.u;
      s.baseShadoweData.translatey += rel.v;
      drawing.drawRect(s.baseShadoweData, ctx, drawBaseShadowTexture, s.baseshadowcanvas, false);
      s.baseShadoweData.translatex -= rel.u;
      s.baseShadoweData.translatey -= rel.v;
    }
  };
  function drawBaseRectShadow() {
    // merge baserect and baserectshadow on visible canvases
    sheetengine.context.save();
    sheetengine.context.globalAlpha = shadows.shadowAlpha;
    sheetengine.context.drawImage(shadows.baseshadowCanvas,sheetengine.canvasCenter.u-scene.tilesize.x,sheetengine.canvasCenter.v-2*scene.tilesize.y);
    sheetengine.context.restore();
  };
  function drawSheetShadow(sheet) {
    if (sheet.hidden)
      return;
      
    // shadow calculations for a shaded sheet can be skipped - we dont draw shadows on shaded sheets
    var drawshadows = !sheet.shaded && shadows.drawShadows && sheet.allowshadows;
    
    if (drawshadows) {
      sheet.shadowtempcontext.clearRect(0, 0, sheet.width, sheet.height);

      sheet.shadowData = [];
      
      // draw all polygon shadow to shadowcanvas with given transformation
      for (var j=0;j<sheet.polygons.length; j++) {
        var sheetpoly = sheet.polygons[j];
        var shadowconstraints = sheetpoly.shadowconstraints;
        
        // go through shadowconstraints of the polygon: these will cast shadows on this polygon
        var sheetsconstraints = [];
        for (var k=0;k<shadowconstraints.length;k++) {
          var shadowcaster = sheetengine.polygons[shadowconstraints[k]].sheetindex;
            
          // more polygonconstraints can point to the same sheet. 
          // let's check if the current shadowcaster sheet has already been processed
          if (sheetsconstraints.indexOf(shadowcaster) != -1)
            continue;
          sheetsconstraints.push(shadowcaster);
          
          var shadowcastersheet = sheetengine.sheets[shadowcaster];

          // only visible sheets cast shadows
          if (shadowcastersheet.hidden)
            continue;
      
      if (!shadowcastersheet.castshadows)
        continue;
      
          // draw shadow on sheet's shadowtempcanvas
          sheet.shadowtempcontext.save();
          
          // set clipping area on sheet for current polygon
          sheet.shadowtempcontext.beginPath();
          for (var pi=0;pi<sheetpoly.points.length;pi++) {
            sheet.shadowtempcontext.lineTo(sheetpoly.pointscanvasuv[pi].u, sheetpoly.pointscanvasuv[pi].v);
          }
          sheet.shadowtempcontext.closePath();
          sheet.shadowtempcontext.clip();

          // lazy initialize shadowdata for current sheet with respect to shadowcaster
          if (sheet.shadowData[shadowcastersheet.index] == null) 
            sheet.shadowData[shadowcastersheet.index] = calculateShadowData(sheet, shadowcastersheet);
          
          var sheetData = sheet.shadowData[shadowcastersheet.index];
          sheet.shadowtempcontext.transform(sheetData.ta,sheetData.tb,sheetData.tc,sheetData.td,sheetData.translatex,sheetData.translatey);
          sheet.shadowtempcontext.drawImage(shadowcastersheet.shadowcanvas, 0, 0);
          sheet.shadowtempcontext.restore();
        }
      }
    }

    // draw original image and then shadows cast by other sheets onto composite context
    sheet.compositecontext.save();
    sheet.compositecontext.drawImage(sheet.canvas, 0, 0);

    // draw own shadow to imitate shading
    if (sheet.shaded) {
      sheet.compositecontext.globalCompositeOperation = 'source-over';
      sheet.compositecontext.globalAlpha = shadows.shadeAlpha;
      sheet.compositecontext.drawImage(sheet.shadowcanvas, 0, 0);
    } else {
      var shadeThresh = 0;
      if (sheet.shadealpha > shadeThresh) {
        sheet.compositecontext.globalCompositeOperation = 'source-over';
        sheet.compositecontext.globalAlpha = sheet.shadealpha;
        sheet.compositecontext.drawImage(sheet.shadowcanvas, 0, 0);
      } else {
        sheet.compositecontext.globalCompositeOperation = 'source-atop';
        sheet.compositecontext.globalAlpha = (shadeThresh - sheet.shadealpha * 6);
        sheet.compositecontext.fillStyle = '#FFF';
        sheet.compositecontext.fillRect(0,0,sheet.width,sheet.height);
      }
    }
    
    if (drawshadows) {
      // draw shadows cast by other sheets
      // an alpha layer is already drawn (shade), so shadow alpha should be lessened with shade alpha to avoid sum of alphas
      sheet.compositecontext.globalAlpha = shadows.shadowAlpha-sheet.shadealpha;
      sheet.compositecontext.globalCompositeOperation = 'source-atop';
      sheet.compositecontext.drawImage(sheet.shadowtempcanvas, 0, 0);
    }
    sheet.compositecontext.restore();
  };
  function calculateSheetsShadows(calculateAll) {
    // determine sheet ordering from lightsource viewpoint
    for (var i=0; i<sheetengine.sheets.length; i++) {
      var sheet = sheetengine.sheets[i];
      if (sheet.shadowdirty || sheet.dirty || calculateAll)
        drawSheetShadow(sheet);
    }
  };
  function calculateShadowData(sheet, shadowcaster) {
    var s = shadowcaster;
    var l = shadows.lightSource;
    
    // calculate centerp-p0-p1-p2 crossing with baserect
    // vector of light source
    var centerp = { x: s.centerp.x, y: s.centerp.y, z: s.centerp.z }; 
    var p0 = { x: s.centerp.x + s.p0.x, y: s.centerp.y + s.p0.y, z: s.centerp.z + s.p0.z }; 
    var p1 = { x: s.centerp.x + s.p1.x, y: s.centerp.y + s.p1.y, z: s.centerp.z + s.p1.z }; 
    var p2 = { x: s.centerp.x + s.p2.x, y: s.centerp.y + s.p2.y, z: s.centerp.z + s.p2.z }; 

    // n*(r-r0) = 0
    // sheet.normalp.x * (X - sheet.centerp.x) + sheet.normalp.y * (Y - sheet.centerp.y) + sheet.normalp.z * (Z - sheet.centerp.z) = 0
    // p0 line : p0 + l*t  -->  X = p0.x + l.x*t
    var tc = getTForSheetLineCrossing(sheet.normalp, sheet.centerp, centerp, l);
    var t0 = getTForSheetLineCrossing(sheet.normalp, sheet.centerp, p0, l);
    var t1 = getTForSheetLineCrossing(sheet.normalp, sheet.centerp, p1, l);
    var t2 = getTForSheetLineCrossing(sheet.normalp, sheet.centerp, p2, l);
    
    var centerpsect = { x: centerp.x + l.x*tc, y: centerp.y + l.y*tc, z: centerp.z + l.z*tc };
    var p0sect = { x: p0.x + l.x*t0 - centerpsect.x, y: p0.y + l.y*t0 - centerpsect.y, z: p0.z + l.z*t0 - centerpsect.z };
    var p1sect = { x: p1.x + l.x*t1 - centerpsect.x, y: p1.y + l.y*t1 - centerpsect.y, z: p1.z + l.z*t1 - centerpsect.z };
    var p2sect = { x: p2.x + l.x*t2 - centerpsect.x, y: p2.y + l.y*t2 - centerpsect.y, z: p2.z + l.z*t2 - centerpsect.z };
    
    // calculate transformation for shadow rectangle
    var eData = calculateSheetDataSingle(centerpsect, p0sect, p1sect, p2sect, transforms.transformPoint, null, sheetengine.canvasCenter, null);
    
    // sheet.data inverse transform:
    var A1 = geometry.getBaseMatrixInverse({x:sheet.data.ta,y:sheet.data.tb,z:0},{x:sheet.data.tc,y:sheet.data.td,z:0},{x:sheet.data.translatex,y:sheet.data.translatey,z:1});
    var C = multiplyMatrices(A1.b1,A1.b2,A1.b3, {x:eData.ta,y:eData.tb,z:0},{x:eData.tc,y:eData.td,z:0},{x:eData.translatex,y:eData.translatey,z:1});

    var sheetData = { translatex: C.c3.x, translatey: C.c3.y, ta: C.c1.x, tb: C.c1.y, tc: C.c2.x, td: C.c2.y};
    return sheetData;
  };
  function isSheetDark(sheet, viewSource) {
    var v = viewSource;
    var l = shadows.lightSource;

    // check if sheet is back to lightsource and if its back to viewsource
    // if its back to both or none: it is light
    // if its back to only lihtsource or only viewsource: it is dark
    var lightPoint = {x:sheet.centerp.x - (l.x*100), y:sheet.centerp.y - (l.y*100), z:sheet.centerp.z - (l.z*100) };
    var viewPoint = {x:sheet.centerp.x - (v.x*100), y:sheet.centerp.y - (v.y*100), z:sheet.centerp.z - (v.z*100) };
    // n*(r-r0) > 0 ? check for lightpoint
    var nrr0 = sheet.normalp.x * (lightPoint.x - sheet.centerp.x) + sheet.normalp.y * (lightPoint.y - sheet.centerp.y) + sheet.normalp.z * (lightPoint.z - sheet.centerp.z);
    // n*(r-r0) > 0 ? check for viewpoint
    var nrr02 = -sheet.normalp.x * (viewPoint.x - sheet.centerp.x) - sheet.normalp.y * (viewPoint.y - sheet.centerp.y) - sheet.normalp.z * (viewPoint.z - sheet.centerp.z);
    
    var backToLightSource = nrr0 < 0;
    var backToViewSource = nrr02 < 0;
    return (backToLightSource && backToViewSource) || (!backToLightSource && !backToViewSource);
  };
  function calculateSheetShade(sheet) {
    if (!sheet.allowshadows) {
      sheet.shaded = false;
      sheet.shadealpha = 0;
      return;
    }
    
    var l = shadows.lightSource;
    var n = sheet.normalp;
    var scale = 3;
    
    // find enclosing angle between sheet normal and lightsource
    // AB*sinT = AXB -> T = arcsin ( AXB / AB )
    var axb = geometry.vectorMagnitude(crossProduct(l,n));
    var ab = geometry.vectorMagnitude(l) * geometry.vectorMagnitude(n);
    var t = Math.asin(axb/ab) / (Math.PI*scale);
    
    // check if sheet is away from viewsource
    sheet.shaded = isSheetDark(sheet, sheetengine.viewSource);
    
    // set sheet shade: 1 full black, 0 full original color
    sheet.shadealpha = t-0.05;
  };
  function drawBaseRectShadows(context, offset) {
    if (!offset)
      offset = {u:0,v:0};
    context.save();
    context.globalAlpha = shadows.shadowAlpha;
    context.drawImage(shadows.baseshadowCanvas,offset.u,offset.v);
    context.restore();
  };
  
  shadows.calculateSheetBaseShadow = calculateSheetBaseShadow;
  shadows.initBaseRectShadow = initBaseRectShadow;
  shadows.drawBaseRectShadow = drawBaseRectShadow;
  shadows.calculateSheetsShadows = calculateSheetsShadows;
  shadows.calculateSheetShade = calculateSheetShade;
  
  
  // ===================================================================================================
  // drawing functions
  var drawing = {};  
  sheetengine.drawing = drawing;

  // callbacks
  drawing.drawBaseRect = null;
  drawing.drawBeforeSheets = null;
  drawing.drawAfterSheets = null;
  
  drawing.useClipCorrection = false;
  drawing.dimmedAlpha = 0.2;      // rate at which sheets are dimmed if dimmer sheets get behind them
  
  drawing.allowContourDrawing = true;
  drawing.hoveredSheetColor = '#F80';
  drawing.selectedSheetColor = '#00F';
  drawing.selectrectlinewidth = 2;
  
  function createCanvas(w, h) {
    var canvas = document.createElement('canvas');
    canvas.width = w;
    canvas.height = h;
    return canvas;
  };
  function redraw() {
    sheetengine.context.clearRect(0,0, sheetengine.canvas.width, sheetengine.canvas.height);
    if (drawing.drawBaseRect)
      drawing.drawBaseRect();
    if (shadows.drawShadows) {
      shadows.initBaseRectShadow(shadows.baseshadowContext, {w:shadows.baseshadowCanvas.width, h:shadows.baseshadowCanvas.height}, {u:0,v:0});
      shadows.drawBaseRectShadow();
    }
    if (drawing.drawBeforeSheets)
      drawing.drawBeforeSheets();
    drawing.drawSheets(sheetengine.context);
    if (drawing.drawAfterSheets)
      drawing.drawAfterSheets();
  };
  function drawRect(sheetdata, context, drawFunction, canvas, allowContourDrawing, poly) {
    // if the sheet is not visible from this angle, draw its contour only
    var a = round2digits(sheetdata.p1uv.u, 1000);
    var b = round2digits(sheetdata.p1uv.v, 1000);
    var c = round2digits(sheetdata.p2uv.u, 1000);
    var d = round2digits(sheetdata.p2uv.v, 1000);

    if ((a == 0 && c == 0) || (c == 0 && d == 0) || (a == 0 && b == 0) || (b == 0 && d == 0) || (a+b == 0 && c+d == 0)) {
      if (allowContourDrawing && drawing.allowContourDrawing)
        drawSelectRect(sheetdata, context, 0)
      return;
    }
  
    context.save();
    if (poly != null) {
      // check if all sheet corners are included in polygon 
      var allcornersincluded = true;
      for (var i=0;i<4;i++) {
        var c = sheetdata.cornersuv[i];
        var cornerincluded = false;
        for (var polyi=0;polyi<poly.points.length;polyi++) {
          var p = poly.data.pointsuv[polyi];
          if (c.u == p.u && c.v == p.v) {
            cornerincluded = true;
            break;
          }
        }
        if (!cornerincluded) {
          allcornersincluded = false;
          break;
        }
      }
      if (!allcornersincluded) {
        context.beginPath();
        for (var polyi=0;polyi<poly.points.length;polyi++) {
          var p = poly.data.pointsuv[polyi];
          // use clip correction
          if (drawing.useClipCorrection) {
            var avg = poly.data.avguv;
            var corru = (p.u - avg.u) * 0.03;
            var corrv = (p.v - avg.v) * 0.03;
            context.lineTo(p.u+corru, p.v+corrv);
          } else {
            context.lineTo(p.u, p.v);
          }
        }
        context.closePath();
        context.clip();
      }
    }
    context.transform(sheetdata.ta,sheetdata.tb,sheetdata.tc,sheetdata.td,sheetdata.translatex,sheetdata.translatey);
    drawFunction(context, canvas);
    context.beginPath();  // empty paths
    context.restore();
  };
  function drawTexture(context, canvas) {
    context.drawImage(canvas, 0, 0);
  };
  function drawBaseShadowTexture(context, canvas) {
    context.drawImage(canvas, 0, 0);
  };
  function drawSelectRect(sheetdata, context, selected) {
    context.save();
    
    context.globalAlpha = 1;
    switch (selected) {
      case 0: context.strokeStyle = '#000';
        break;
      case 1: context.strokeStyle = '#00F';
          context.globalAlpha = 0.5;
        break;
      case 2: context.strokeStyle = '#F80';
          context.globalAlpha = 0.5;
        break;
      case 3: context.strokeStyle = '#00F';
        break;
    }
    context.lineWidth = drawing.selectrectlinewidth;
    
    context.beginPath();
    context.moveTo(sheetdata.cornersuv[0].u, sheetdata.cornersuv[0].v);
    context.lineTo(sheetdata.cornersuv[1].u, sheetdata.cornersuv[1].v);
    context.lineTo(sheetdata.cornersuv[2].u, sheetdata.cornersuv[2].v);
    context.lineTo(sheetdata.cornersuv[3].u, sheetdata.cornersuv[3].v);
    context.lineTo(sheetdata.cornersuv[0].u, sheetdata.cornersuv[0].v);
    context.closePath();
    context.stroke();

    context.restore();
  };
  function redrawSheetCanvases(sheet) {
    // create images of shadows cast by this sheet
    // draw image, then paint it black wherever it is not transparent. leave it transparent otherwise.
    sheet.baseshadowcontext.save();
    sheet.baseshadowcontext.clearRect(0,0,sheet.width,sheet.height);
    sheet.baseshadowcontext.drawImage(sheet.canvas,0,0);
    sheet.baseshadowcontext.globalCompositeOperation = 'source-in';
    sheet.baseshadowcontext.fillStyle = '#000';
    sheet.baseshadowcontext.fillRect(0,0,sheet.width,sheet.height);
    sheet.baseshadowcontext.restore();
    
    sheet.shadowcontext.save();
    sheet.shadowcontext.clearRect(0,0,sheet.width,sheet.height);
    sheet.shadowcontext.drawImage(sheet.canvas,0,0);
    sheet.shadowcontext.globalCompositeOperation = 'source-in';
    sheet.shadowcontext.fillStyle = '#000';
    sheet.shadowcontext.fillRect(0,0,sheet.width,sheet.height);
    sheet.shadowcontext.restore();
  };
  function drawSheetSelection(sheet, polygon, sheetData, context) {
    var hoverSheet = sheetengine.hoverSheet != -1 ? sheetengine.sheets[sheetengine.hoverSheet] : null;
    var hovered = sheetengine.hoverSheet == sheet.index || (hoverSheet != null && sheet.group != null && sheet.group == hoverSheet.group) || (hoverSheet != null && sheet.objectsheet && sheet.object == hoverSheet.object);
    var selected = sheetengine.currentSheet == sheet.index;
    var inSelection = sheet.inSelection;
    if (hovered || selected || inSelection) {
      var color = 1; // hovered
      if (inSelection || selected) 
        color = 2;
      drawSelectPoly(sheetData, context, color, sheet, polygon);
    }
  };
  function drawSelectPoly(sheetdata, context, color, sheet, poly) {
    context.save();
    
    context.globalAlpha = 1;
    switch (color) {
      case 1: context.strokeStyle = drawing.hoveredSheetColor;
        break;
      case 2: context.strokeStyle = drawing.selectedSheetColor;
        break;
    }
    context.lineWidth = 2;

    context.beginPath();
    for (var j=0;j<poly.points.length;j++) {
      var next = j == poly.points.length - 1 ? 0 : j + 1;
      context.moveTo(poly.data.pointsuv[j].u, poly.data.pointsuv[j].v);
      var inframe = pointsInFrame(poly.data.pointsuv[j], poly.data.pointsuv[next], sheetdata.cornersuv);

      if (inframe) {
        context.lineTo(poly.data.pointsuv[next].u, poly.data.pointsuv[next].v);
      }
    }
    
    context.closePath();
    context.stroke();

    context.restore();
  };
  function pointsInFrame(p1, p2, cornersuv) {
    return pointsInFrameLine(p1,p2,cornersuv[0],cornersuv[1]) ||
      pointsInFrameLine(p1,p2,cornersuv[1],cornersuv[2]) ||
      pointsInFrameLine(p1,p2,cornersuv[2],cornersuv[3]) ||
      pointsInFrameLine(p1,p2,cornersuv[3],cornersuv[0]);
  };
  function pointsInFrameLine(p1, p2, c1,c2) {
    var diffu1 = p1.u-c1.u;
    var diffu2 = p2.u-c1.u;
    var diffu3 = c2.u-c1.u;
    var diffv1 = p1.v-c1.v;
    var diffv2 = p2.v-c1.v;
    var diffv3 = c2.v-c1.v;
    var div1 = (diffu1/diffu3);
    var div2 = (diffv1/diffv3);
    var div3 = (diffu2/diffu3);
    var div4 = (diffv2/diffv3);
    var thresh1 = 0.1;
    var thresh2 = 2;
    var inline = (Math.abs(div1 - div2) < thresh1 && Math.abs(div3 - div4) < thresh1) || (Math.abs(diffu3) < thresh2 && Math.abs(diffu2) < thresh2 & Math.abs(diffu1) < thresh2) || (Math.abs(diffv3) < thresh2 && Math.abs(diffv2) < thresh2 && Math.abs(diffv1) < thresh2);
    return inline;
  };
  function drawSheets(context, viewport) {
    if (sheetengine.sheets.length == 0)
      return;
    
    for (var i=0; i<sheetengine.orderedPolygons.length; i++) {
      var polygon = sheetengine.polygons[sheetengine.orderedPolygons[i]];
      var sheet = sheetengine.sheets[polygon.sheetindex];
      if (viewport) {
        var sheetdata = sheet.data;
        if (sheetdata.centerpuv.u < viewport.minu || sheetdata.centerpuv.u > viewport.maxu || sheetdata.centerpuv.v < viewport.minv || sheetdata.centerpuv.v > viewport.maxv)
          continue;
      }
      if (sheet.hidden)
        continue;
      if (sheet.dimmed) {
        context.save();
        context.globalAlpha = drawing.dimmedAlpha;
      }
      drawing.drawRect(sheet.data, context, drawTexture, sheet.compositecanvas, true, polygon);
      if (sheet.dimmed) {
        context.restore();
      }
      drawSheetSelection(sheet, polygon, sheet.data, context);
    }
  };
  function getPointuv(p) {
    var puv = transforms.transformPoint(p);
    return {
      u:puv.u+sheetengine.canvasCenter.u-scene.center.u,
      v:puv.v+sheetengine.canvasCenter.v-scene.center.v};
  };
  function drawScenePart(options) {
    var viewPort = options.viewPort;        // {u,v,w,h}
    var targetContext = options.targetContext;    // this.context
    var targetBaseShadowContext = options.targetBaseShadowContext;
    var targetBaseShadowCanvas = options.targetBaseShadowCanvas;
  
    if (!targetContext) {
      targetContext = sheetengine.temppartcontext;
      targetBaseShadowContext = sheetengine.temppartshadowcontext;
      targetBaseShadowCanvas = sheetengine.temppartshadowcanvas;
    }

    // clear canvas
    targetContext.fillStyle = sheetengine.backgroundColor;
    targetContext.fillRect(0, 0, viewPort.w, viewPort.h);
  
    var u = viewPort.u + sheetengine.canvasCenter.u;
    var v = viewPort.v + sheetengine.canvasCenter.v;

    // translate canvas
    targetContext.save();
    targetContext.translate(-u, -v);

    // draw baserects
    drawBaseRects(targetContext);

    // select the region of interest
    var distance = sheetengine.boundingBoxMaxsheetDistance;
    var minu = viewPort.u - distance; 
    var minv = viewPort.v - distance;
    var maxu = viewPort.u + viewPort.w + distance;
    var maxv = viewPort.v + viewPort.h + distance;

    // draw baseshadows
    var shadowrel = {u:-u+scene.center.u+sheetengine.canvasCenter.u-shadows.baseShadowCenter.u,v:-v+scene.center.v+sheetengine.canvasCenter.v-shadows.baseShadowCenter.v};
    initBaseRectShadow(targetBaseShadowContext, {w:viewPort.w, h:viewPort.h}, shadowrel, {minu:minu, maxu:maxu, minv:minv, maxv:maxv});
    targetContext.save();
    targetContext.globalAlpha = shadows.shadowAlpha;
    targetContext.drawImage(targetBaseShadowCanvas,u,v);
    targetContext.restore();

    // draw sheets
    drawSheets(targetContext, {minu:minu, maxu:maxu, minv:minv, maxv:maxv});
  
    targetContext.restore();
  };
  function drawScene(full) {
    if (full) {
      if (sheetengine.backgroundcanvas) {
        // clear canvas
        sheetengine.backgroundcontext.clearRect(0,0, sheetengine.backgroundcanvas.width, sheetengine.backgroundcanvas.height);

        // draw baserects
        sheetengine.backgroundcontext.save();
        sheetengine.backgroundcontext.translate(-sheetengine.canvasCenter.u+shadows.baseShadowCenter.u,-sheetengine.canvasCenter.v+shadows.baseShadowCenter.v);
        drawBaseRects(sheetengine.backgroundcontext);
        sheetengine.backgroundcontext.restore();

        // draw baseshadows
        var shadowrel = {u:scene.center.u,v:scene.center.v};
        shadows.initBaseRectShadow(shadows.baseshadowContext, {w:shadows.baseshadowCanvas.width, h:shadows.baseshadowCanvas.height}, shadowrel, null);
        drawBaseRectShadows(sheetengine.backgroundcontext,{u:sheetengine.backgroundtranslate.u,v:sheetengine.backgroundtranslate.v});

        // draw sheets
        sheetengine.backgroundcontext.save();
        sheetengine.backgroundcontext.translate(-sheetengine.canvasCenter.u+shadows.baseShadowCenter.u,-sheetengine.canvasCenter.v+shadows.baseShadowCenter.v);
        drawing.drawSheets(sheetengine.backgroundcontext, null);
        sheetengine.backgroundcontext.restore();
      } else {
        // clear canvas
        sheetengine.context.clearRect(0,0, sheetengine.canvas.width, sheetengine.canvas.height);

        // draw baserects
        drawBaseRects(sheetengine.context);

        // draw baseshadows
        var shadowrel = {u:scene.center.u,v:scene.center.v};
        shadows.initBaseRectShadow(shadows.baseshadowContext, {w:shadows.baseshadowCanvas.width, h:shadows.baseshadowCanvas.height}, shadowrel, null);
        drawBaseRectShadows(sheetengine.context);
      
        // draw sheets
        drawing.drawSheets(sheetengine.context, null);
      }
      if (sheetengine.drawObjectContour) {
        for (var i=0;i<sheetengine.objects.length;i++) {
          var obj = sheetengine.objects[i];
          obj.canvasdirty = true;
          obj.draw();
        }
      }
    } else {
  
      // update background (if any sheet's dimmed state is changed) - this also applies for not moving objects!
      for (var i=0;i<sheetengine.sheets.length;i++) {
        var s = sheetengine.sheets[i];
      
        var dimmedChanged = s.dimmed != s.dimmedprev;
        s.dimmedprev = s.dimmed;
      
        if (dimmedChanged) {
          // redraw background for this sheet
          // viewport will be the bounding box of the sheet
          var w = Math.ceil(s.data.umax - s.data.umin);
          var h = Math.ceil(s.data.vmax - s.data.vmin);
          var u = s.data.umin - sheetengine.canvasCenter.u;
          var v = s.data.vmin - sheetengine.canvasCenter.v;
        
          drawScenePart({
            viewPort: {u:u, v:v, w:w, h:h} 
          });
          var canvas = sheetengine.backgroundcanvas ? sheetengine.backgroundcanvas : sheetengine.canvas;
          var context = sheetengine.backgroundcanvas ? sheetengine.backgroundcontext : sheetengine.context;
          u += canvas.width/2;
          v += canvas.height/2;
          w-=1;  // fix drawing inaccuracies
          h-=1;
          context.drawImage(sheetengine.temppartcanvas,0,0,w,h,u,v,w,h);
        }
      }
    
      // draw objects
      for (var i=0;i<sheetengine.objects.length;i++) {
        var obj = sheetengine.objects[i];
        obj.draw();
      }
    }
  
    // position background
    if (sheetengine.backgroundcanvas) {
      sheetengine.context.clearRect(0,0,sheetengine.canvas.width,sheetengine.canvas.height);
      var offsetu = -scene.center.u - sheetengine.backgroundcanvas.width/2 + sheetengine.canvas.width/2;
      var offsetv = -scene.center.v - sheetengine.backgroundcanvas.height/2 + sheetengine.canvas.height/2;
      offsetu += sheetengine.backgroundtranslate.u;
      offsetv += sheetengine.backgroundtranslate.v;
      sheetengine.context.drawImage(sheetengine.backgroundcanvas,offsetu,offsetv);
    }
  };
  function drawBaseRects(context) {
    for (var i=0;i<sheetengine.basesheets.length;i++) {
      var basesheet = sheetengine.basesheets[i];
      drawing.drawRect(basesheet.data, context, function(ctx, canvas) {
        ctx.fillStyle = basesheet.color;
        ctx.fillRect(0,0,basesheet.width,basesheet.height);
      }, null, false);
    }
  };
  
  drawing.createCanvas = createCanvas;
  drawing.redraw = redraw;
  drawing.drawRect = drawRect;
  drawing.redrawSheetCanvases = redrawSheetCanvases;
  drawing.drawSheets = drawSheets;
  drawing.getPointuv = getPointuv;
  drawing.drawScene = drawScene;
  
  
  // ===================================================================================================
  // sheet-intersections
  var intersections = {};
  sheetengine.intersections = intersections;
  intersections.intersections = true;
  var polygonMidpointsForOverlapCheck = [{dist:50, numpoints:4}, {dist:20, numpoints:3}, {dist:10, numpoints:2}, {dist:0, numpoints:1}];
  //var polygonMidpointsForOverlapCheck = [{dist:50, numpoints:0}];
  
  function getIntersection(n,p,c1,c2) {
    // two lines: L1=P1+aV1;  L2=P2+bV2
    // (here v1=n, p1=p, v2=c2-c1, p2=c1)
    // aV1=(P2-P1)+bV2; X V2 -> a(V1 X V2) = (P2-P1) X V2
    // a=(P2-P1) X V2 / (V1 X V2) - division here is with magnitudes of vectors
    var p2 = c1;
    var n2 = {x: c2.x - c1.x,
        y: c2.y - c1.y,
        z: c2.z - c1.z};
    
    var p2p = {x: p.x-p2.x, y:p.y-p2.y, z:p.z-p2.z};
    var cp1 = crossProduct(p2p,n);
    var cp2 = crossProduct(n2,n);
    var t = geometry.vectorMagnitude(cp1) / geometry.vectorMagnitude(cp2);
    
    // check: by taking magnitudes of vectors, we lose information. t might be -t, but when?
    // cp1 is t times cp2, so the following sum should be 0. if not, t should be taken as -t
    var check = cp2.x * t + cp2.y*t + cp2.z*t - cp1.x - cp1.y - cp1.z;
    if (Math.round(check) != 0)
      t = -t;
    
    return {p: {x: p2.x+t*n2.x, y: p2.y+t*n2.y, z: p2.z+t*n2.z}, inside: t>=0 && t<=1, t:t };
  };
  function pointsEqual(p1,p2) {
    return Math.round(p1.x)==Math.round(p2.x) && Math.round(p1.y)==Math.round(p2.y) && Math.round(p1.z)==Math.round(p2.z);
    //return p1.x==p2.x && p1.y==p2.y && p1.z==p2.z;
  };
  function bisectCornerList(corners, n, p) {
    // algorithm: we will create two polygons from a corner list, in two phases. in the first phase
    // we gather all corners including intersection points, and mark intersections. from the gathered corners
    // we eliminate x-c and x-c-x patterns where a single line crosses near a corner making 3 corners -> this
    // only counts as one. in the second phase we start out from one intersection point (there should be exactly 2)
    // to the left and to the right until we reach the second intersection -> the corners we cover will be the 
    // corners of the first and second polygon.
    
    // gather all corners and intersection points, mark intersections position
    var allcorners = [];
    var firstintersect = null;
    var secondintersect = null;
    var inintersection = false; // this is to detect c-x-c
    for (var i=0;i<corners.length;i++) {
      var j = i == corners.length-1 ? 0 : i + 1;
      var corneradded = false;
      // add corner if point not yet added. for x-c only x will be in array.
      if ((allcorners.length == 0) || (!pointsEqual(allcorners[allcorners.length-1], corners[i]))) {
        allcorners[allcorners.length] = corners[i];
        corneradded = true;
      }
      var p1 = getIntersection(n, p, corners[i], corners[j]);
      if (p1.inside) {
        var pointalreadyadded = pointsEqual(allcorners[allcorners.length-1], p1.p);
        // add intersection if point not yet added. for x-x only x will be in array. 
        // (x-c-x is eliminated in two steps: first x-c is x above, and here x-x is x.
        if (!pointalreadyadded) {
          if (firstintersect == null)
            firstintersect = allcorners.length;
          else if (secondintersect == null)
            secondintersect = allcorners.length;
          allcorners[allcorners.length] = p1.p;
        }
        // mark previous point as intersection for c-x
        if ((pointalreadyadded) && (corneradded)) {
          if (firstintersect == null)
            firstintersect = allcorners.length - 1;
          else if (secondintersect == null)
            secondintersect = allcorners.length - 1;
        }
      }
    }

    // no intersection or only one intersection: return
    if (secondintersect == null)
      return null;
    
    // start from first intersection to the left till second intersection, and put all corners in poly 0
    // start from first intersection to the right till second intersection, and put all corners in poly 1
    var poly = [];
    poly[0] = [];
    poly[1] = [];
    var index = firstintersect;
    for (;;) {
      poly[0][poly[0].length] = geometry.clonePoint(allcorners[index]);
      if (index == secondintersect)
        break;
      index--;
      if (index < 0)
        index = allcorners.length - 1;
    }
    index = firstintersect;
    for (;;) {
      poly[1][poly[1].length] = geometry.clonePoint(allcorners[index]);
      if (index == secondintersect)
        break;
      index++;
      if (index > allcorners.length - 1)
        index = 0;
    }
    return poly;
  };
  function isInsideCornerList(corners, n, p) {
    for (var i=0;i<corners.length;i++) {
      var j = i == corners.length-1 ? 0 : i + 1;
      var p1 = getIntersection(n, p, corners[i], corners[j]);
      if (p1.inside)
        return true;
    }
    return false;
  };
  function getIntersectionLineofPlanes(a, b) {
    // check if planes are far away from each other
    var maxdiag = a.maxdiag + b.maxdiag;
    var distance = Math.sqrt(
      ((a.centerp.x-b.centerp.x)*(a.centerp.x-b.centerp.x))+
      ((a.centerp.y-b.centerp.y)*(a.centerp.y-b.centerp.y))+
      ((a.centerp.z-b.centerp.z)*(a.centerp.z-b.centerp.z)));
    if (distance > maxdiag)
      return null;
      
    var n1n2 = a.normalp.x*b.normalp.x+a.normalp.y*b.normalp.y+a.normalp.z*b.normalp.z;
    // planes parallel
    if (n1n2 == 1)
      return null;

    var n1n1 = a.normalp.x*a.normalp.x+a.normalp.y*a.normalp.y+a.normalp.z*a.normalp.z;
    var n2n2 = b.normalp.x*b.normalp.x+b.normalp.y*b.normalp.y+b.normalp.z*b.normalp.z;
      
    // calculate line vector of section line: cross product of normalvectors
    // x-2y+2z=1, 3x-y-z=2  -> (1,-2,2)x(3,-1,-1)->(4,7,5). 
    var n = crossProduct(a.normalp, b.normalp);
    
    var d1 = (a.normalp.x*a.centerp.x+a.normalp.y*a.centerp.y+a.normalp.z*a.centerp.z);
    var d2 = (b.normalp.x*b.centerp.x+b.normalp.y*b.centerp.y+b.normalp.z*b.centerp.z);
    
    var det = n1n1*n2n2-n1n2*n1n2;
    var c1 = (d1*n2n2 - d2*n1n2)/det;
    var c2 = (d2*n1n1 - d1*n1n2)/det;
    
    // line is c1 N1 + c2 N2 + t N1 * N2
    // -> (p) + t(n)
    var p = {x: c1*a.normalp.x + c2*b.normalp.x,
        y: c1*a.normalp.y + c2*b.normalp.y,
        z: c1*a.normalp.z + c2*b.normalp.z};
    
    return {n:n, p:roundVector2digits(p, 10000)};
  };
  function doSheetsIntersect(s1, s2) {
    // calculate section of sheets
    var line = getIntersectionLineofPlanes(s1, s2);
    
    // initialize intersectionparams for both sheets - these data will be used later when calculating sheet sections
    s1.intersectionParams[s2.index] = { line: line };
    s2.intersectionParams[s1.index] = { line: line };
    
    if (line == null)
      return false;
  
    // check if line falls inside both sheets
    var insideS1 = isInsideCornerList(s1.corners, line.n, line.p);
    var insideS2 = isInsideCornerList(s2.corners, line.n, line.p);
    
    // extend intersectionParams with inside-info
    s1.intersectionParams[s2.index].insideThis = insideS1;
    s1.intersectionParams[s2.index].insideOther = insideS2;
    s2.intersectionParams[s1.index].insideThis = insideS2;
    s2.intersectionParams[s1.index].insideOther = insideS1;

    return insideS1 && insideS2;
  };
  function calculatePolygonsForSheet(sheet, sheetset) {
    if (sheet.hidden)
      return;
    
    if (!sheetset)
      sheetset = sheetengine.sheets;
    
    for (var s=0;s<sheetset.length;s++) {
      var othersheet = sheetset[s];
      if (othersheet.index == sheet.index)
        continue;
    
      if (othersheet.hidden)
        continue;
      
      var intersectionParams = sheet.intersectionParams[othersheet.index];
      
      var line = intersectionParams == null ? 
        getIntersectionLineofPlanes(sheet, othersheet) :
        intersectionParams.line;
      if (line == null)
        continue;
      
      // check if line falls inside both sheets
      var startpolygons1 = null;
      var poly1initialized = false;
      var startpolygons2 = null;
      var poly2initialized = false;
      var inside = false;
      if (sheet.polygons.length == 1) {
        startpolygons1 = bisectCornerList(sheet.corners, line.n, line.p);
        inside = !(startpolygons1 == null);
        poly1initialized = true;
      } else {
        inside = intersectionParams == null ?
          isInsideCornerList(sheet.corners, line.n, line.p) :
          intersectionParams.insideThis;
      }
      // current sheet falls out of line, next sheet intersection
      if (!inside)
        continue;

      inside = intersectionParams == null ?
        isInsideCornerList(othersheet.corners, line.n, line.p) :
        intersectionParams.insideOther;
        
      // other sheet falls out of line, next sheet intersection
      if (!inside)
        continue;
      
      // bisect all polygons of current sheet with s
      var newpoly = [];
      for (var i=0; i<sheet.polygons.length; i++) {
        var polygons = null;
        if (poly1initialized) {
          polygons = startpolygons1;
          poly1initialized = false;
        } else {
          polygons = bisectCornerList(sheet.polygons[i].points, line.n, line.p);
        }
        // if current polygon is not intersected, put it in the list intact,
        // otherwise put the resulting polygon sections in the list
        if (polygons == null)
          newpoly[newpoly.length] = sheet.polygons[i];
        else {
          newpoly[newpoly.length] = { points: polygons[0] };
          newpoly[newpoly.length] = { points: polygons[1] };
        }
      }
      sheet.polygons = newpoly;
      sheet.intersectors.push(othersheet.index);
    }
  };
  function filterPolygons(polygons) {
    // throw out polygons that don't count (e.g. polygons with 2 points, etc.)
    var newpoly = [];
    for (var p=0;p<polygons.length;p++) {
      var poly = polygons[p];
      if (poly.points.length == 2)
        continue;
            
      newpoly.push(poly);
    }
    return newpoly;
  };
  function calculateSheetSections(sheet, full, sheetset) {
    var currentsheet = sheet;

    // initialize sheets' polygon lists with corner lists
    if (full) {
      currentsheet.polygons = [];
      currentsheet.polygons[0] = { points: currentsheet.corners };

      // calculate intersection polygons with all intersecting sheets
      currentsheet.intersectors = [];
      if (intersections.intersections)
        calculatePolygonsForSheet(currentsheet, sheetset);
    
      // throw out polygons that don't count (e.g. polygons with 2 points, etc.)
      currentsheet.polygons = filterPolygons(currentsheet.polygons);
    }

    // calculate uv coordinates for poly of current sheet
    for (var p=0;p<currentsheet.polygons.length;p++) {
      var poly = currentsheet.polygons[p];
      var umin = 10000, umax = -10000, vmin = 10000, vmax = -10000, zmin = 10000, zmax = -10000;
      poly.pointscanvasuv = [];
      poly.data = { umin:umin, umax:umax, vmin:vmin, vmax:vmax, zmin:zmin, zmax:zmax, pointsuv: [] };
      poly.shData = { umin:umin, umax:umax, vmin:vmin, vmax:vmax, zmin:zmin, zmax:zmax, pointsuv: [] };
    
      var avg = {u:0,v:0};
      for (var pi=0;pi<poly.points.length;pi++) {
        var polypointspi = poly.points[pi];
        // calculate polygon point in canvas uv coordinate system -> for later use at shadows
        poly.pointscanvasuv[pi] = getPointForCanvasUV(currentsheet, polypointspi);
        
        // calculate transformation-specific data for polygon points
        poly.data.pointsuv[pi] = transforms.transformPointuvz(polypointspi, transforms.transformPointz, sheetengine.canvasCenter);
        
        avg.u += poly.data.pointsuv[pi].u;
        avg.v += poly.data.pointsuv[pi].v;
        
        // for shadow corner data: get inverse base matrix for view source plane's coordinate system (plane perpendicular to viewsource)
        // the lightsource defines a coordinate system. we will have to define the individual points in this coord system, and then Z' component can be neglected: X' and Y' will be the projected coordinates
        
        var c1xyz = geometry.getCoordsInBase(shadows.shadowBaseMatrixInverse, polypointspi);
        poly.shData.pointsuv[pi] = { u: c1xyz.x, v: c1xyz.y, z: c1xyz.z };
        
        updateuvzMaxMin(poly.data, pi);
        updateuvzMaxMin(poly.shData, pi);
      }
      
      // store average of editor uv coords -> later used in drawing clip corrections
      avg.u /= poly.points.length;
      avg.v /= poly.points.length;
      poly.data.avguv = {u:avg.u, v:avg.v};
      
      // calculate section midpoints for current poly
      // xyz and uv midpoints have to be in sync, since intersecting rays from xyz 
      // and inbounds check for corresponding uv point is carried out for all points
      poly.midpoints = [];
      poly.data.midpointsuv = [];
      poly.shData.midpointsuv = [];
      for (var pi=0;pi<poly.points.length;pi++) {
        var pj = pi == poly.points.length-1 ? 0 : pi + 1;
        var dist = roughPointDist(poly.points[pi], poly.points[pj]);
        var midpoints = getMidpointNum(dist) + 1;
        for (var k=1;k<midpoints;k++) {
          var ratio1 = k;
          var ratio2 = midpoints - ratio1;
          poly.midpoints[poly.midpoints.length] = avgPoints(poly.points[pi], poly.points[pj], ratio1, ratio2, midpoints);
        }
        var p1 = poly.data.pointsuv[pi];
        var p2 = poly.data.pointsuv[pj];
        for (var k=1;k<midpoints;k++) {
          var ratio1 = k;
          var ratio2 = midpoints - ratio1;
          poly.data.midpointsuv[poly.data.midpointsuv.length] = avgPointsuv(p1, p2, ratio1, ratio2, midpoints);
        }
        
        // the above for shadows
        var p1 = poly.shData.pointsuv[pi];
        var p2 = poly.shData.pointsuv[pj];
        for (var k=1;k<midpoints;k++) {
          var ratio1 = k;
          var ratio2 = midpoints - ratio1;
          poly.shData.midpointsuv[poly.shData.midpointsuv.length] = avgPointsuv(p1, p2, ratio1, ratio2, midpoints);
        }
      }
      
      //poly.sheet = cs;
      poly.sheetindex = currentsheet.index;
      poly.index = sheetengine.polygons.length;
      poly.constraints = [];
      poly.shadowconstraints = [];
      sheetengine.polygons.push(poly);
    }
  };
  function updateuvzMaxMin(data, pi) {
    if (data.pointsuv[pi].u < data.umin) data.umin = data.pointsuv[pi].u;
    if (data.pointsuv[pi].u > data.umax) data.umax = data.pointsuv[pi].u;
    if (data.pointsuv[pi].v < data.vmin) data.vmin = data.pointsuv[pi].v;
    if (data.pointsuv[pi].v > data.vmax) data.vmax = data.pointsuv[pi].v;
    if (data.pointsuv[pi].z < data.zmin) data.zmin = data.pointsuv[pi].z;
    if (data.pointsuv[pi].z > data.zmax) data.zmax = data.pointsuv[pi].z;
  };
  function getMidpointNum(dist) {
    for (var k=0;k<polygonMidpointsForOverlapCheck.length;k++) {
      if (dist > polygonMidpointsForOverlapCheck[k].dist)
        return polygonMidpointsForOverlapCheck[k].numpoints;
    }
    return polygonMidpointsForOverlapCheck[polygonMidpointsForOverlapCheck.length-1].numpoints;
  };
  function getPointForCanvasUV(sheet, p) {
    var A1 = sheet.A1;      // use sheet's inverse base matrix to get canvas uv coordinates
    var p0 = sheet.corners[0];  // (0,0) is the first corner
    var p0p = { x:p.x-p0.x, y:p.y-p0.y, z:p.z-p0.z };
    return {
      u: p0p.x*A1.b1.x + p0p.y*A1.b2.x + p0p.z*A1.b3.x,
      v: p0p.x*A1.b1.y + p0p.y*A1.b2.y + p0p.z*A1.b3.y
    };
  };
  
  
  // ===================================================================================================
  // z-ordering
  function calculatePolygonOrder(polygon) {
    calculatePolygonOrderForCam(polygon, 0);
    calculatePolygonOrderForCam(polygon, 1);
  };
  function calculatePolygonOrderForCam(polygon, shadow) {
    // sheet order
    //   - when a sheet is moved, let's compare it to all other sheets
    //   - for every sheet let's define, what other sheets should be drawn before this one: constraint list
    //     - ie. 0>1,3  1>2  2>3
      
    // go through sheets and determine if they are in front of this one
    if (!shadow)
      polygon.constraints = [];
    for (var i=0; i<sheetengine.polygons.length; i++) {
      var polygon2 = sheetengine.polygons[i];
      // other polygons of the same sheet are not related to this polygon
      if (polygon2.sheetindex == polygon.sheetindex)
        continue;
  
      if (sheetengine.sheets[polygon2.sheetindex].hidden || sheetengine.sheets[polygon.sheetindex].hidden)
        continue;

      addPolygonConstraintForCam(polygon, polygon2, shadow);
    }
  };
  function addPolygonConstraint(polygon, polygon2) {
    addPolygonConstraintForCam(polygon, polygon2, 0);
    addPolygonConstraintForCam(polygon, polygon2, 1);
  };
  function addPolygonConstraintForCam(polygon, polygon2, shadow) {
    var polygonData = shadow ? polygon.shData : polygon.data;
    var polygonData2 = shadow ? polygon2.shData : polygon2.data;
    var viewSource = shadow ? shadows.lightSource : sheetengine.viewSource;
    
    var sheet = sheetengine.sheets[polygon.sheetindex];
    var sheet2 = sheetengine.sheets[polygon2.sheetindex];
    
    if (sheet.hidden || sheet2.hidden)
      return;
    
    var isfront = isPolygonFront(polygon2, polygon, sheet2, sheet, polygonData2, polygonData, viewSource, shadow);
    if (!isfront)
      return;
      
    // polygon references polygon2 (front references back)
    if (!shadow) {
      polygon.constraints.push(polygon2.index);
      // if sheet2 is configured to dim sheets that are in front of it, mark the one in the front as dimmed
      if (sheet2.dimSheets && !sheet.dimmingDisabled) {
        // dimming only works if dimmer does not intersect dimmed
        if (sheet2.intersectors.indexOf(sheet.index) == -1)
          sheet.dimmed = 1;
      }
    } else {
      // polygon2 references polygon in shadowconstraints
      polygon2.shadowconstraints.push(polygon.index);
    }
  };
  function getOrderedList() {
    // sheet sort:
    //   - 2 lists: ordered (empty), unordered (full)
    //   - create a candidate list from unordered list:
    //     - for every sheet in unordered list:
    //       - if it does not have constraints or all constraints are already in ordered list -> CANDIDATE
    //       - (if it has constraints that are not in ordered list -> REMOVE CONSTRAINTS FROM CANDIDATE LIST)
    //   - move candidates from unordered to ordered
    //   - repeat until unordered is empty

    var ordered = {};
    //var ordered = [];
    var unordered = [];
    for (var i=0; i<sheetengine.polygons.length; i++) {
      if (sheetengine.sheets[sheetengine.polygons[i].sheetindex].hidden)
        continue;
      unordered.push(i);
    }
    
    for (;;) {
      // create candidate list
      var newunordered = [];
      var candidates = [];
      for (var i=0;i<unordered.length;i++) {
        var constraints = sheetengine.polygons[unordered[i]].constraints;

        // good candidate: no constraints
        // good candidate: all constraints in ordered list
        var allConstraintsInOrdered = true;
        for (var j=0; j<constraints.length; j++) {
          var key = 'k'+constraints[j];
          //if (ordered.indexOf(constraints[j]) == -1)
          if (typeof(ordered[key]) === 'undefined')
          {
            allConstraintsInOrdered = false;
            break;
          }
        }

        if (allConstraintsInOrdered)
          candidates.push(unordered[i]);
        else
          newunordered.push(unordered[i]);
      }
      
      // move candidates to ordered list
      for (var i=0; i<candidates.length; i++) {
      var key = 'k'+candidates[i];
        ordered[key] = candidates[i];
      }
      // var j = ordered.length;
      // for (var i=0; i<candidates.length; i++) {
        // ordered[j++] = candidates[i];
      // }
    

      var nochange = unordered.length == newunordered.length;
      
      // remove candidates from unordered list
      unordered = newunordered;
      
      // if unordered is fully processed - we're done
      if (unordered.length == 0)
        break;

      // circular reference: if nothing changed in this iteration: 
      // from the remaining unordered list find the polygon of highest zmax and put in the list
      if (nochange) {
        var zmax = -10000;
        for (var i=0; i<unordered.length; i++) {
          if (sheetengine.polygons[unordered[i]].data.zmax > zmax) {
            maxidx = i;
            zmax = sheetengine.polygons[unordered[i]].data.zmax;
          }
        }
      var key = 'k'+unordered[maxidx];
        ordered[key] = unordered[maxidx];
        //ordered[ordered.length] = unordered[maxidx];
        unordered.splice(maxidx, 1);
        if (unordered.length == 0)
          break;
      }
    }
  
    var newordered = [];
    for (var key in ordered) {
      newordered.push(ordered[key]);
    }
    //return ordered;
    return newordered;
  };
  function isPolygonFront(a, b, asheet, bsheet, aData, bData, viewSource, shadow) {
    // 1st test: do they overlap in uv? no: return with don't care
    if (aData.umin >= bData.umax || aData.umax <= bData.umin || aData.vmin >= bData.vmax || aData.vmax <= bData.vmin)
      return false;
    
    if (bData.zmin > aData.zmax)
      return false;

    var zOrderDistanceThreshold = 0.3;
  
    // to avoid dimming of close sheets: object sheets should be only considered as dimmers if they are far enough
    if (!shadow && (asheet.objectsheet || bsheet.objectsheet) && (asheet.object != bsheet.object))
      zOrderDistanceThreshold = 5;
    
    // rays from A sheet to B sheet's plane
    // test: is there at least one intersection to - direction that falls inside back rectangle -> swap
    // check c1: if tc1 < 0 and c1uv lies within bc1uv-bc4uv
    for (var i=0;i<aData.pointsuv.length;i++) {
      var t = getTForSheetLineCrossing(bsheet.normalp, bsheet.centerp, a.points[i], viewSource);
      if (t < -zOrderDistanceThreshold) {
        var res = calc.checkInboundsPolygon(bData.pointsuv, aData.pointsuv[i].u, aData.pointsuv[i].v)
        if (res.inbounds)
          return true;
      }
    }

    // also check midpoints
    for (var i=0;i<aData.midpointsuv.length;i++) {
      var t = getTForSheetLineCrossing(bsheet.normalp, bsheet.centerp, a.midpoints[i], viewSource);
      if (t < -zOrderDistanceThreshold) {
        // bounding polygon is the original polygon with set of cornerpoinst, not the set of midpoints
        var res = calc.checkInboundsPolygon(bData.pointsuv, aData.midpointsuv[i].u, aData.midpointsuv[i].v)
        if (res.inbounds)
          return true;
      }
    }

    // rays from B sheet to A sheet's plane
    // test: is there at least one intersection to + direction that falls inside front rectangle -> swap
    // check c1: if tc1 > 0 and c1uv lies within bc1uv-bc4uv
    for (var i=0;i<bData.pointsuv.length;i++) {
      var t = getTForSheetLineCrossing(asheet.normalp, asheet.centerp, b.points[i], viewSource);
      if (t > zOrderDistanceThreshold) {
        var res = calc.checkInboundsPolygon(aData.pointsuv, bData.pointsuv[i].u, bData.pointsuv[i].v)
        if (res.inbounds)
          return true;
      }
    }

    // also check midpoints
    for (var i=0;i<bData.midpointsuv.length;i++) {
      var t = getTForSheetLineCrossing(asheet.normalp, asheet.centerp, b.midpoints[i], viewSource);
      if (t > zOrderDistanceThreshold) {
        // bounding polygon is the original polygon with set of cornerpoinst, not the set of midpoints
        var res = calc.checkInboundsPolygon(aData.pointsuv, bData.midpointsuv[i].u, bData.midpointsuv[i].v)
        if (res.inbounds)
          return true;
      }
    }
      
    return false;
  };
  function clearDimmedFlags() {
    // gather dimmers
    var dimmers = [];
    for (var i=0;i<sheetengine.sheets.length;i++) {
      var s = sheetengine.sheets[i];
      if (s.dimSheets && !s.hidden) {
        for (var j=0;j<s.polygons.length;j++) {
          dimmers.push(s.polygons[j].index);
        }
      }
    }
    if (dimmers.length > 0) {
      for (var i=0;i<sheetengine.sheets.length;i++) {
        var s = sheetengine.sheets[i];
        if (s.dimmed == 0)
          continue;

        // check dimmed sheets, that are not any more dimmed by any dimmer
        var dirty = false;
        for (var j=0;j<s.polygons.length;j++) {
          var sheetpoly = s.polygons[j];
          var constraints = sheetpoly.constraints;
          for (var c=0;c<constraints.length;c++) {
            if (dimmers.indexOf(constraints[c]) != -1) {
              dirty = true;
              break;
            }
          }
        }
        if (!dirty)
          s.dimmed = 0;
      }
    }
  };
  function deleteIndexFromConstraints(deletedSheet, constraints) {
    if (!constraints)
      return;

    // delete from constraint lists
    var containedIdx = constraints.indexOf(deletedSheet);
    if (containedIdx != -1)
      constraints.splice(containedIdx,1);
  };
  function updateIndexInConstraints(oldIndex, newIndex, constraints) {
    if (!constraints)
      return;

    var containedIdx = constraints.indexOf(oldIndex);
    if (containedIdx != -1)
      constraints[containedIdx] = newIndex;
  };
  
  
  // ===================================================================================================
  // sheet calculations after changes
  var calc = {};  
  sheetengine.calc = calc;
  
  function gatherDirtySheets() {
    for (var i=0;i<sheetengine.sheets.length;i++) {
      sheetengine.sheets[i].intersectionParams = [];
    }
    for (var i=0;i<sheetengine.sheets.length;i++) {
      var currentsheet = sheetengine.sheets[i];
    
      if (!currentsheet.dirty)
        continue;
      
      // objectsheets don't make other sheets dirty
      if (!sheetengine.objectsintersect && currentsheet.objectsheet && !currentsheet.object.intersectionsenabled)
        continue;
      
      // - former intersectOR sheets
      if (currentsheet.intersectors != null) {
        for (var j=0;j<currentsheet.intersectors.length;j++) {
          var idx = currentsheet.intersectors[j];
          sheetengine.sheets[idx].madedirty = true;
        }
      }
    
      for (var j=0;j<sheetengine.sheets.length;j++) {
        if (j==i)
          continue;

        var othersheet = sheetengine.sheets[j];
        if (othersheet.hidden)
          continue;
      
        // if othersheet is already made dirty, we are ready
        if (othersheet.madedirty)
          continue;

        // if either of the two sheets are objectsheet, intersections will be handled separately
        if (!sheetengine.objectsintersect && currentsheet.objectsheet && !currentsheet.object.intersectionsenabled)
          continue;
        if (!sheetengine.objectsintersect && othersheet.objectsheet && !othersheet.object.intersectionsenabled)
          continue;
        
        // - new intersecting sheets
        if (doSheetsIntersect(currentsheet,othersheet)) {
          othersheet.madedirty = true;
        }
        
        // - former intersecTED sheets
        if (othersheet.intersectors != null) {
          if (othersheet.intersectors.indexOf(i) != -1)
            othersheet.madedirty = true;
        }
      }
    }
    // build dirtySheets array
    var movedSheets = [];
    var dirtySheets = [];
    var dirtySheetsRedefinePolygons = [];
    for (var i=0;i<sheetengine.sheets.length;i++) {
      var sheet = sheetengine.sheets[i];
        
      if (sheetengine.objectsintersect) {
        // if object intersection is allowed, simple mechanism: we only care about sheets and not objects
        if (sheet.dirty || sheet.madedirty) {
          dirtySheets.push(i);
          dirtySheetsRedefinePolygons.push(i);
        }
      } else {
        // if objects don't intersect, complex mechanism: all sheets of a dirty object will be included
        // (since all polygons of a dirty object will be recalculated, they all must be deleted, even if the sheet itself is not dirty)
        var objdirty = sheet.objectsheet && (sheet.object.intersectionsredefine || sheet.object.intersectionsrecalc) && !sheet.object.intersectionsenabled;
        if (sheet.dirty || sheet.madedirty || objdirty) {
          dirtySheets.push(i);
      
          var objectintersection = sheet.objectsheet && !sheet.object.intersectionsenabled;
          if (!objectintersection)
            dirtySheetsRedefinePolygons.push(i);
        }
      }
    
      if (sheet.dirty) {
        movedSheets.push(i);
      }
    }
    return {dirtySheets: dirtySheets, movedSheets: movedSheets, dirtySheetsRedefinePolygons: dirtySheetsRedefinePolygons};
  };
  function deleteDirtyPolygons(dirtySheets) {
    if (sheetengine.polygons == null)
      sheetengine.polygons = [];

    // delete references from sheetengine.polygons
    var polys = [];
    for (var j=0;j<sheetengine.polygons.length;j++) {
      // check if polygon's sheet is among dirty ones
      var poly = sheetengine.polygons[j];
      var containedIdx = dirtySheets.indexOf(poly.sheetindex);
      if (containedIdx != -1) {
        // delete polygon index from z-order constraints
        for (var i=0;i<sheetengine.polygons.length;i++) {
          var actPoly = sheetengine.polygons[i];
          // delete from constraint lists
          deleteIndexFromConstraints(poly.index, actPoly.constraints);
          deleteIndexFromConstraints(poly.index, actPoly.shadowconstraints);
          deleteIndexFromConstraints(poly.index, actPoly.prevshadowconstraints);
        }
      } else {
        polys[polys.length] = sheetengine.polygons[j];
      }
    }
    sheetengine.polygons = polys;
    
    // update polygon indexes
    for (var j=0;j<sheetengine.polygons.length;j++) {
      if (sheetengine.polygons[j].index != j) {
        
        // update z-order constraint indexes
        for (var i=0;i<sheetengine.polygons.length;i++) {
          var actPoly = sheetengine.polygons[i];
          updateIndexInConstraints(sheetengine.polygons[j].index, j, actPoly.constraints);
          updateIndexInConstraints(sheetengine.polygons[j].index, j, actPoly.shadowconstraints);
          updateIndexInConstraints(sheetengine.polygons[j].index, j, actPoly.prevshadowconstraints);
        }
        
        // update index in polygonlist
        sheetengine.polygons[j].index = j;
      }
    }
  };
  function calculateDirtyPolygonOrder(firstDirtyPolygon) {
    for (var i=firstDirtyPolygon;i<sheetengine.polygons.length;i++) {
      var dirtyPoly = sheetengine.polygons[i];
      calculatePolygonOrder(dirtyPoly);
      
      // calculate all polygons z-order constraints with respect to dirty polygons
      for (var k=0;k<firstDirtyPolygon;k++) {
        var staticPoly = sheetengine.polygons[k];
        var staticSheet = sheetengine.sheets[staticPoly.sheetindex];
        if (staticSheet.hidden)
          continue;
        addPolygonConstraint(staticPoly, dirtyPoly);
      }
    }
  };
  function setPrevShadowConstraints() {
    for (var i=0;i<sheetengine.polygons.length;i++) {
      sheetengine.polygons[i].prevshadowconstraints = [];
      for (var j=0;j<sheetengine.polygons[i].shadowconstraints.length;j++) {
        sheetengine.polygons[i].prevshadowconstraints[sheetengine.polygons[i].prevshadowconstraints.length] = sheetengine.polygons[i].shadowconstraints[j];
      }
    }
  };
  function updateOrderedLists() {
    sheetengine.orderedPolygons = getOrderedList();
  };
  function getStaticSheets() {
    if (staticsheets != null)
    return staticsheets;
    
    var sheetset = [];
    for (var i=0;i<sheetengine.sheets.length;i++) {
      var s = sheetengine.sheets[i];
      if (!s.objectsheet || s.object.intersectionsenabled)
        sheetset.push(s);
    }
    staticsheets = sheetset;
    return staticsheets;
  }
  function calculateChangedSheets() {
    var start1 = +new Date;
  
    // 1. gather sheets whose polygons are to be recalculated
    //    - dirty sheets
    //    - sheets that previously intersected dirty sheets
    //    - sheets that now intersect dirty sheets
    var dirtySheetsObj = gatherDirtySheets();
    var dirtySheets = dirtySheetsObj.dirtySheets;
    var movedSheets = dirtySheetsObj.movedSheets;
    var dirtySheetsRedefinePolygons = dirtySheetsObj.dirtySheetsRedefinePolygons;

    var end1 = +new Date;
    var start2 = +new Date;
  
    // redraw canvases where canvas changed
    for (var i=0;i<sheetengine.sheets.length;i++) {
      var s = sheetengine.sheets[i];
      if (s.canvasdirty)
        s.refreshCanvas();
    }
    
    // gather sheets for shadow redrawing
    //    - sheets whose shadowcasters previously included a dirty sheet
    // this is done here, because the next step is to delete polygons and recalculate polygon indexes -> information for
    // dirty sheets may be lost
    checkDirtyShadowConstraint(true, movedSheets);
    
    var end2 = +new Date;
    var start3 = +new Date;
    
    // 2. delete polygons of dirty sheets
    deleteDirtyPolygons(dirtySheets);
    var firstDirtyPolygon = sheetengine.polygons.length;
    
    var end3 = +new Date;
    var start4 = +new Date;
  
    // 3. redefine polygons
    if (sheetengine.objectsintersect) {
      // redefine polygons of all sheets
      var sheetset = sheetengine.sheets;
      for (var idx=0; idx<dirtySheetsRedefinePolygons.length; idx++) {
        calculateSheetSections(sheetengine.sheets[dirtySheetsRedefinePolygons[idx]], true, sheetset);
      }
    } else {
      // redefine polygons of static sheets
      var sheetset = getStaticSheets();
      for (var idx=0; idx<dirtySheetsRedefinePolygons.length; idx++) {
        calculateSheetSections(sheetengine.sheets[dirtySheetsRedefinePolygons[idx]], true, sheetset);
      }
  
      // recalculate/redefine polygons of object sheets
      for (var idx=0;idx<sheetengine.objects.length;idx++) {
        var obj = sheetengine.objects[idx];
        if (obj.intersectionsenabled)
          continue;
        if (obj.intersectionsredefine) {
          redefineIntersections(obj);
        } else if (obj.intersectionsrecalc) {
          for (var i=0;i<obj.sheets.length;i++) {
            calculateSheetSections(obj.sheets[i], false, obj.sheets);
          }
        }
        obj.intersectionsredefine = false;
        obj.intersectionsrecalc = false;
      }
    }
  
    var end4 = +new Date;
    var start5 = +new Date;

    // 4. calculate z-order constraints of dirty polygons
    // and calculate all polygons' constraints with respect to dirty polygons
    calculateDirtyPolygonOrder(firstDirtyPolygon);
    
    var end5 = +new Date;
    var start6 = +new Date;
  
    // 5. clear dimmed flags for sheets that are not dimmed any more
    // (in 4 we did not touch the unmoved dimmers, so we can't clear flags for sheets dimmed by unmoved dimmers)
    clearDimmedFlags();
    
    var end6 = +new Date;
    var start7 = +new Date;
  
    // gather sheets for shadow redrawing
    //    - sheets whose shadowcasters include a dirty sheet
    checkDirtyShadowConstraint(false, movedSheets);

    var end7 = +new Date;
    var start8 = +new Date;
  
    // set previous constraints for polygons
    setPrevShadowConstraints();

    var end8 = +new Date;
    var start9 = +new Date;

    // draw shadows on sheet canvases
    shadows.calculateSheetsShadows(false);
    
    var end9 = +new Date;
    var start10 = +new Date;
  
    updateOrderedLists();

    var end10 = +new Date;
  
    // clear dirty flags
    for (var i=0;i<sheetengine.sheets.length;i++) {
      sheetengine.sheets[i].dirty = false;
      sheetengine.sheets[i].madedirty = false;
    }
  
    // delete all sheets that were marked as deleting
    deleteSheets();
  
    if (sheetengine.debug)
      console.log((end1-start1) + ' - ' + (end2-start2) + ' - ' + (end3-start3) + ' - ' + (end4-start4) + ' - ' + (end5-start5) + ' - ' + (end6-start6) + ' - ' + (end7-start7) + ' - ' + (end8-start8) + ' - ' + (end9-start9) + ' - ' + (end10-start10));
  };
  function calculateAllSheets() {
    for (var i=0;i<sheetengine.sheets.length;i++) {
      var s = sheetengine.sheets[i];
      s.dimmed = 0;  // clear dimmed flag for all sheets, it will be set with calculating constraints
      s.intersectionParams = [];
    
    // redraw canvases where canvas changed
    if (s.canvasdirty)
      s.refreshCanvas();
    }
    sheetengine.polygons = [];
    // recalculate intersection of static sheets
    staticsheets = null;
    var sheetset = sheetengine.objectsintersect ? sheetengine.sheets : getStaticSheets();
    for (var idx=0; idx<sheetset.length; idx++) {
      calculateSheetSections(sheetset[idx], true, sheetset);
    }
    // recalculate intersection of object sheets
    if (!sheetengine.objectsintersect) {
      for (var idx=0;idx<sheetengine.objects.length;idx++) {
        var obj = sheetengine.objects[idx];
        if (obj.intersectionsenabled)
          continue;
        if (obj.intersectionsredefine) {
          redefineIntersections(obj);
        } else {
          for (var i=0;i<obj.sheets.length;i++) {
            calculateSheetSections(obj.sheets[i], true, obj.sheets);
          }
        }
        obj.intersectionsredefine = false;
        obj.intersectionsrecalc = false;
      }
    }
  
    for (var i=0;i<sheetengine.polygons.length;i++) {
      calculatePolygonOrder(sheetengine.polygons[i]);
    }
    setPrevShadowConstraints();
    shadows.calculateSheetsShadows(true);
    updateOrderedLists();
    // clear dirty flags
    for (var i=0;i<sheetengine.sheets.length;i++) {
      var s = sheetengine.sheets[i];
      s.dirty = false;
      s.madedirty = false;
    }
  
    // delete all sheets that were marked as deleting
    deleteSheets();
  };
  function deleteSheets() {
    if (!sheetengine.sheetsbeingdeleted)
      return;

    // remove deleted sheets' polygons from sheetengine.polygons
    var newpolys = [];
    var deletedpolyidxs = [];
    for (var p=0;p<sheetengine.polygons.length;p++) {
      var poly = sheetengine.polygons[p];
      var psheet = sheetengine.sheets[poly.sheetindex];
      if (!psheet.deleting)
        newpolys.push(poly);
      else 
        deletedpolyidxs.push(p);
    }
    sheetengine.polygons = newpolys;

    // remove deleted sheets' polygons from orderedPolygons
    var neworderedpolys = [];
    for (var p=0;p<sheetengine.orderedPolygons.length;p++) {
      var polyidx = sheetengine.orderedPolygons[p];
      if (deletedpolyidxs.indexOf(polyidx) == -1)
        neworderedpolys.push(polyidx);
    }
    sheetengine.orderedPolygons = neworderedpolys;

    // remove deleted sheets' polygons from polygons' constraints
    for (var p=0;p<sheetengine.polygons.length;p++) {
      var poly = sheetengine.polygons[p];

      var newconstraints = [];
      for (var si=0;si<poly.constraints.length;si++) {
        var polyidx = poly.constraints[si];
        if (deletedpolyidxs.indexOf(polyidx) == -1)
          newconstraints.push(polyidx);
      }
      poly.constraints = newconstraints;
    
      var newshadowconstraints = [];
      for (var si=0;si<poly.shadowconstraints.length;si++) {
        var polyidx = poly.shadowconstraints[si];
        if (deletedpolyidxs.indexOf(polyidx) == -1)
          newshadowconstraints.push(polyidx);
      }
      poly.shadowconstraints = newshadowconstraints;
    
      var newshadowconstraints = [];
      for (var si=0;si<poly.prevshadowconstraints.length;si++) {
        var polyidx = poly.prevshadowconstraints[si];
        if (deletedpolyidxs.indexOf(polyidx) == -1)
          newshadowconstraints.push(polyidx);
      }
      poly.prevshadowconstraints = newshadowconstraints;
    }
    
    // remove deleted sheets from sheetengine.sheets
    var newsheets = [];
    var deletedsheetidxs = [];
    for (var s=0;s<sheetengine.sheets.length;s++) {
      var sheet = sheetengine.sheets[s];
      if (!sheet.deleting)
        newsheets.push(sheet);
      else 
        deletedsheetidxs.push(s);
    }
    sheetengine.sheets = newsheets;

    // remove deleted sheet indexes from intersectors
    for (var s=0;s<sheetengine.sheets.length;s++) {
      var sheet = sheetengine.sheets[s];
      if (!sheet.intersectors)
        continue;
      var newintersectors = [];
      for (var is=0;is<sheet.intersectors.length;is++) {
        var isindex = sheet.intersectors[is];
        if (deletedsheetidxs.indexOf(isindex) == -1)
          newintersectors.push(isindex);
      }
      sheet.intersectors = newintersectors;
    }
  
    // adjust sheet indexes
    for (var i=0;i<sheetengine.sheets.length;i++) {
      var oldindex = sheetengine.sheets[i].index;
      sheetengine.sheets[i].index = i;
      if (oldindex != i) {
        // adjust indices in polygon array
        for (var j=0;j<sheetengine.polygons.length;j++) {
          var poly = sheetengine.polygons[j];
          if (poly.sheetindex == oldindex)
            poly.sheetindex = i;
        }

        // adjust indices in intersector array
        for (var s=0;s<sheetengine.sheets.length;s++) {
          var sheet = sheetengine.sheets[s];
          updateIndexInConstraints(oldindex, i, sheet.intersectors);
        }
      }
    }
  
    // update polygon indexes
    for (var j=0;j<sheetengine.polygons.length;j++) {
      var oldindex = sheetengine.polygons[j].index;
      if (oldindex != j) {
        // adjust indexes in orderedPolygons
        updateIndexInConstraints(oldindex, j, sheetengine.orderedPolygons);
    
        // update z-order constraint indexes
        for (var i=0;i<sheetengine.polygons.length;i++) {
          var actPoly = sheetengine.polygons[i];
          updateIndexInConstraints(oldindex, j, actPoly.constraints);
          updateIndexInConstraints(oldindex, j, actPoly.shadowconstraints);
          updateIndexInConstraints(oldindex, j, actPoly.prevshadowconstraints);
        }
        
        // update index in polygonlist
        sheetengine.polygons[j].index = j;
      }
    }

    sheetengine.sheetsbeingdeleted = false;
    staticsheets = null;  // mark staticsheets for recollecting
  };
  function deleteObject(obj) {
    var idx = sheetengine.objects.indexOf(obj);
    if (idx != -1)
      sheetengine.objects.splice(idx,1);
  };
  
  // sheet calculations
  calc.allowLimitToCorners = false;
  calc.sheetLimits = { xmin: -150, xmax: 150, ymin: -150, ymax: 150, zmin: 0, zmax: 100 };
  
  var inboundsCheckZeroThresh = 0.001;  // calculated area might be very close to zero for small polygons. in this case it should be counted as zero.
  
  function checkInboundsPolygon(corners, myx, myy) {
    var areas = [];
    var allpositive = true;
    var allnegative = true;
    var allzero = true;
    for (var i=0;i<corners.length;i++) {
      var j = i == corners.length - 1 ? 0 : i + 1;
      // area of triangle: c[i], c[j], my
      areas[areas.length] = myx*corners[j].v - corners[j].u*myy - myx*corners[i].v + corners[i].u*myy + corners[j].u*corners[i].v - corners[i].u*corners[j].v;
      if ((areas[areas.length-1]) > inboundsCheckZeroThresh) {
        allnegative = false;
        allzero = false;
      }
      if ((areas[areas.length-1]) < -inboundsCheckZeroThresh) {
        allpositive = false;
        allzero = false;
      }
    }
    return { inbounds: (allnegative || allpositive) && !allzero, areas: areas, allzero: allzero };
  };
  function calcUdifVdif(sheet) {
    var scalew = sheet.width / 2;
    var scaleh = sheet.height / 2;
    sheet.udif = { x: sheet.p1.x*scalew, y: sheet.p1.y*scalew, z: sheet.p1.z*scalew };
    sheet.vdif = { x: sheet.p2.x*scaleh, y: sheet.p2.y*scaleh, z: sheet.p2.z*scaleh };
  };
  function calculateSheetData(sheet) {
    var centerp = sheet.centerp;
    var p0 = sheet.p0;
    var p1 = sheet.p1;
    var p2 = sheet.p2;

    // corners
    calcUdifVdif(sheet);
    sheet.corners = calculateCornersFromCenter(centerp,sheet.udif,sheet.vdif);
    
    // inverse basematrix
    sheet.A1 = geometry.getBaseMatrixInverse(sheet.p1, sheet.p2, sheet.normalp);
    
    // transformation-specific data
    sheet.data = calculateSheetDataSingle(centerp, p0, p1, p2, transforms.transformPoint, transforms.transformPointz, sheetengine.canvasCenter, sheet.corners);
    
    // calculate shadows cast on baserect
    if (shadows.drawShadows)
      shadows.calculateSheetBaseShadow(sheet);

    // mark sheet as dirty for z-ordering
    sheet.dirty = true;
  };
  function calculateSheetDataSingle(centerp, p0rot, p1rot, p2rot, transformFunction, transformFunctionz, canvasCenter, corners) {
    // we calculate the new position of the center
    var centerpuv = transformFunction(centerp);
    
    // from the angles we calculate 3 cornerpoints of the sheet: p0 is top left
    var p0rotScale = { x: p0rot.x, y: p0rot.y, z: p0rot.z };
    var p1rotScale = { x: p1rot.x, y: p1rot.y, z: p1rot.z };
    var p2rotScale = { x: p2rot.x, y: p2rot.y, z: p2rot.z };
    
    var p0 = transformFunction(p0rotScale);
    var p1 = transformFunction(p1rotScale);
    var p2 = transformFunction(p2rotScale);
    
    // p1 and p2 are the cornerpoints of the square, so that 0,0 is lower left, p1 is lower right and p2 is upper left point
    // p1 and p2 will define the transformation with respect to 0,0, and the whole thing should be translated to p0
    
    var translatex = canvasCenter.u + p0.u + centerpuv.u;
    var translatey = canvasCenter.v + p0.v + centerpuv.v;
    
    var ta = p1.u;
    var tb = p1.v;
    var tc = p2.u;
    var td = p2.v;
    
    if (corners == null)
      return { p0uv: p0, p1uv: p1, p2uv: p2, translatex: translatex, translatey: translatey, ta: ta, tb: tb, tc: tc, td: td, centerpuv: centerpuv};
      
    // cornerpoints
    var c = [];
    c[0] = transforms.transformPointuvz(corners[0], transformFunctionz, canvasCenter);
    c[1] = transforms.transformPointuvz(corners[1], transformFunctionz, canvasCenter);
    c[2] = transforms.transformPointuvz(corners[2], transformFunctionz, canvasCenter);
    c[3] = transforms.transformPointuvz(corners[3], transformFunctionz, canvasCenter);
    
    var umax = Math.max(c[0].u, c[1].u, c[2].u, c[3].u);
    var umin = Math.min(c[0].u, c[1].u, c[2].u, c[3].u);
    var vmax = Math.max(c[0].v, c[1].v, c[2].v, c[3].v);
    var vmin = Math.min(c[0].v, c[1].v, c[2].v, c[3].v);
    var zmax = Math.max(c[0].z, c[1].z, c[2].z, c[3].z);
    var zmin = Math.min(c[0].z, c[1].z, c[2].z, c[3].z);
    return { p0uv: p0, p1uv: p1, p2uv: p2, translatex: translatex, translatey: translatey, ta: ta, tb: tb, tc: tc, td: td, centerpuv: centerpuv, cornersuv: c, umax: umax, umin: umin, vmax: vmax, vmin: vmin, zmax: zmax, zmin: zmin };
  };
  function calculateCornersFromCenter(centerp,udif,vdif) {
    var corners = [];
    corners[0] = { x: -udif.x -vdif.x + centerp.x, y: -udif.y -vdif.y + centerp.y, z: -udif.z -vdif.z + centerp.z};
    corners[1] = { x: +udif.x -vdif.x + centerp.x, y: +udif.y -vdif.y + centerp.y, z: +udif.z -vdif.z + centerp.z};
    corners[2] = { x: +udif.x +vdif.x + centerp.x, y: +udif.y +vdif.y + centerp.y, z: +udif.z +vdif.z + centerp.z};
    corners[3] = { x: -udif.x +vdif.x + centerp.x, y: -udif.y +vdif.y + centerp.y, z: -udif.z +vdif.z + centerp.z};
    return corners;
  };
  function limitToCorners(sheet) {
    calcUdifVdif(sheet);
    sheet.corners = calculateCornersFromCenter(sheet.centerp,sheet.udif,sheet.vdif);
    
    if (!calc.allowLimitToCorners)
      return;
    
    sheet.xsnap = sheet.ysnap = sheet.zsnap = sheet.xexactsnap = sheet.yexactsnap = sheet.zexactsnap = sheet.xminsnap = sheet.xmaxsnap = sheet.yminsnap = sheet.ymaxsnap = sheet.zminsnap = sheet.zmaxsnap = false;
    for (var l=0;l<4;l++) {
      limitToCorner(sheet, sheet.corners[l], l);
    }
  };
  function limitToCorner(sheet, c, index) {
    var udif = sheet.udif;
    var vdif = sheet.vdif;
    
    if (c.x <= calc.sheetLimits.xmin) {
      // !sheet.xsnap: if xsnap is true it means that a previous corner has been recorrected previously
      // this previous recorrection may result in this corner to be located exactly at limit
      // but in this case it is not exact snap, so exactsnap state should not be altered
      if (c.x == calc.sheetLimits.xmin && !sheet.xsnap)
        sheet.xexactsnap = true;
      c.x = calc.sheetLimits.xmin;
      sheet.xsnap = true;
      sheet.xminsnap = true;
    }
    if (c.x >= calc.sheetLimits.xmax) {
      if (c.x == calc.sheetLimits.xmax && !sheet.xsnap)
        sheet.xexactsnap = true;
      c.x = calc.sheetLimits.xmax;
      sheet.xsnap = true;
      sheet.xmaxsnap = true;
    }
    if (c.y <= calc.sheetLimits.ymin) {
      if (c.y == calc.sheetLimits.ymin && !sheet.ysnap)
        sheet.yexactsnap = true;
      c.y = calc.sheetLimits.ymin;
      sheet.ysnap = true;
      sheet.yminsnap = true;
    }
    if (c.y >= calc.sheetLimits.ymax) {
      if (c.y == calc.sheetLimits.ymax && !sheet.ysnap)
        sheet.yexactsnap = true;
      c.y = calc.sheetLimits.ymax;
      sheet.ysnap = true;
      sheet.ymaxsnap = true;
    }    
    if (c.z <= calc.sheetLimits.zmin) {
      if (c.z == calc.sheetLimits.zmin && !sheet.zsnap)
        sheet.zexactsnap = true;
      c.z = calc.sheetLimits.zmin;
      sheet.zsnap = true;
      sheet.zminsnap = true;
    }
    if (c.z >= calc.sheetLimits.zmax) {
      if (c.z == calc.sheetLimits.zmax && !sheet.zsnap)
        sheet.zexactsnap = true;
      c.z = calc.sheetLimits.zmax;
      sheet.zsnap = true;
      sheet.zmaxsnap = true;
    }    
    
    // calculate center from corner
    if (index == 0)
      sheet.centerp = { x: c.x + udif.x + vdif.x, y: c.y + udif.y + vdif.y, z: c.z + udif.z + vdif.z };
    if (index == 1)
      sheet.centerp = { x: c.x - udif.x + vdif.x, y: c.y - udif.y + vdif.y, z: c.z - udif.z + vdif.z };
    if (index == 2)
      sheet.centerp = { x: c.x - udif.x - vdif.x, y: c.y - udif.y - vdif.y, z: c.z - udif.z - vdif.z };
    if (index == 3)
      sheet.centerp = { x: c.x + udif.x - vdif.x, y: c.y + udif.y - vdif.y, z: c.z + udif.z - vdif.z };
      
    // recalculate all corners from center
    sheet.corners = calculateCornersFromCenter(sheet.centerp,udif,vdif);
  };
  function defineSheetParams(sheet) {
    // p0orig: p0 in the initial default orientation. 
    // p0start: p0 in the initial orientation after first rotated with the given angles
    sheet.p0orig = {x:-sheet.width/2,y:0,z:sheet.height/2};
    sheet.p1orig = {x:1,y:0,z:0};
    sheet.p2orig = {x:0,y:0,z:-1};
    sheet.normalporig = {x:0,y:1,z:0};
    
    // if sheet is an objectsheet, p0,p1,p2,normalp will be calculated with the rotation of the object and not from sheet rot params
    if (!sheet.objectsheet) {
      alpha = sheet.rot.alphaD * Math.PI / 180;
      beta = sheet.rot.betaD * Math.PI / 180;
      gamma = sheet.rot.gammaD * Math.PI / 180;
      
      sheet.p0 = sheet.p0start = geometry.rotatePoint(sheet.p0orig,alpha,beta,gamma);
      sheet.p1 = sheet.p1start = geometry.rotatePoint(sheet.p1orig,alpha,beta,gamma);
      sheet.p2 = sheet.p2start = geometry.rotatePoint(sheet.p2orig,alpha,beta,gamma);
      sheet.normalp = sheet.normalpstart = geometry.rotatePoint(sheet.normalporig,alpha,beta,gamma);
    }
    
    // set maxdiagonal for intersection check
    sheet.maxdiag = Math.ceil(Math.sqrt(sheet.width*sheet.width+sheet.height*sheet.height) / 2);
  };
  
  calc.checkInboundsPolygon = checkInboundsPolygon;
  calc.calculateSheetData = calculateSheetData;
  calc.limitToCorners = limitToCorners;
  calc.defineSheetParams = defineSheetParams;
  calc.calculateChangedSheets = calculateChangedSheets;
  calc.calculateAllSheets = calculateAllSheets;  
  
  
  // ===================================================================================================
  // scene functions
  var scene = {};
  sheetengine.scene = scene;
  
  scene.yardcenterstart = {yardx:0, yardy:0}; // defines the initial center position (defines which yard is displayed in the center)
  scene.yardcenter = {yardx:0, yardy:0};     // defines the current center position.
  scene.center = {x:0, y:0, u:0, v:0};    // center of the drawn scene
  scene.tilewidth = 300;
  scene.tilesize = { x: 212, y: 106 };
  
  
  function init(canvasElement, backgroundSize) {
    drawing.allowContourDrawing = false;
  
    sheetengine.sheets = [];
    sheetengine.basesheets = [];
    sheetengine.polygons = [];
    sheetengine.objects = [];
    startsheets = [];
    loadedyards = {};
    staticsheets = null;
  
    sheetengine.canvas = canvasElement;
    sheetengine.context = sheetengine.canvas.getContext('2d');
    sheetengine.canvasCenter = {u:sheetengine.canvas.width/2,v:sheetengine.canvas.height/2}; // main canvas center
  
    shadows.baseshadowCanvas = drawing.createCanvas(sheetengine.canvas.width, sheetengine.canvas.height);
  
    if (backgroundSize) {
      shadows.baseshadowCanvas.width = backgroundSize.w;
      shadows.baseshadowCanvas.height = backgroundSize.h;
      sheetengine.backgroundcanvas = drawing.createCanvas(backgroundSize.w, backgroundSize.h);
      sheetengine.backgroundcontext = sheetengine.backgroundcanvas.getContext('2d');
      sheetengine.backgroundtranslate = {u:0, v:0};

      sheetengine.temppartcanvas = drawing.createCanvas(sheetengine.tempCanvasSize.w, sheetengine.tempCanvasSize.h);
      sheetengine.temppartcontext = sheetengine.temppartcanvas.getContext('2d');
      sheetengine.temppartshadowcanvas = drawing.createCanvas(sheetengine.tempCanvasSize.w, sheetengine.tempCanvasSize.h);
      sheetengine.temppartshadowcontext = sheetengine.temppartshadowcanvas.getContext('2d');
    }
    shadows.baseshadowContext = shadows.baseshadowCanvas.getContext('2d');
    shadows.baseShadowCenter = {u:shadows.baseshadowCanvas.width/2,v:shadows.baseshadowCanvas.height/2};
  };
  function addYards(yards, callback) {
    var newsheets = [];
    var newobjects = [];
    
    if (yards) {
      for (var i=0;i<yards.length;i++) {
        var yard = yards[i];
          
        var offset = { x: (yard.x - scene.yardcenterstart.yardx)*scene.tilewidth, y: (yard.y - scene.yardcenterstart.yardy)*scene.tilewidth, z: 0 };

        var basesheet = new sheetengine.BaseSheet(offset, {alphaD:-90, betaD:0, gammaD:0}, {w:scene.tilewidth, h:scene.tilewidth});
        basesheet.color = yard.baserectcolor;

        var sheets;
        if (yard.sheets) {
          sheets = createSheets(yard.sheets, offset);
          newsheets = newsheets.concat(sheets);
        } else {
          sheets = [];
        }
        
        var objects = yard.objects;
        var yardObjects = [];
        if (objects) {
          for (var j=0;j<objects.length;j++) {
            var objdata = objects[j];
            var createdObj = objhelpers.defineObject(objdata.name);
            if (!createdObj)
              continue;
            createdObj.id = 'x'+yard.x+'y'+yard.y+'i'+j;
            yardObjects.push(createdObj);
            newobjects.push(createdObj);
            createdObj.setPosition(geometry.addPoint(objdata.centerp, offset));
            createdObj.oldcenterp = clonePoint(createdObj.centerp);  // set oldcenterp to centerp as this is the initial position
            createdObj.setOrientation(objdata.rot);
            newsheets = newsheets.concat(createdObj.sheets);
          }
        }
        
        var newyard = {sheets: sheets, basesheet: basesheet, x:yard.x, y:yard.y, objects: yardObjects};
        var key = 'x'+yard.x+'y'+yard.y;
        loadedyards[key] = newyard;
      }
    }
    
    startsheets = newsheets;
    if (newsheets.length == 0) {
      callback([], []);
      return;
    }
    
    // draw images on canvases
    sheetengine.imgCount = 0;
    for (var i=0;i<newsheets.length;i++) {
      var img = new Image();
      var context = newsheets[i].canvas.getContext('2d');
      img.onload = imageOnload(newsheets[i], context, img, newsheets.length, function() { callback(newsheets, newobjects); });
      img.src = newsheets[i].canvasdata;
      newsheets[i].canvasdata = null;
    }
  };
  function createSheets(sheetdata, offset) {
    var sheets = [];
    if (sheetdata == null) 
      return sheets;
      
    for (var i=0;i<sheetdata.length;i++) {
      var data = sheetdata[i];
      var sheet = new sheetengine.Sheet(
        geometry.addPoint(data.centerp, offset), 
        data.rot, 
        {w:data.width, h:data.height}
      );
      sheet.canvasdata = data.canvas;
      sheets.push(sheet);
    }
    return sheets;
  };
  function imageOnload(sheet, context, img, count, callback) {
    return function() {
      context.drawImage(img, 0,0);
    sheet.canvasChanged();
      sheetengine.imgCount++;
      if (sheetengine.imgCount == count) {
        callback();
      }
    }
  };
  function moveBaseShadows(vector, sheets) {
    if (!shadows.drawShadows)
      return;

    var sheets = sheets ? sheets : sheetengine.sheets;
    for (var i=0;i<sheets.length;i++) {
      var s = sheets[i];
      s.baseShadoweData.translatex -= vector.u;
      s.baseShadoweData.translatey -= vector.v;
    }
  };
  function initScene(centerp) {
    calc.calculateAllSheets();
    
    var centerpuv = transforms.transformPoint(centerp);
    scene.center = {x:centerp.x, y:centerp.y, u:centerpuv.u, v:centerpuv.v};
    
    moveBaseShadows(scene.center);
  };
  function moveCenter(vectorxyz, vectoruv) {
    if (!vectoruv) {
      if (!vectorxyz.z)
        vectoruv = transforms.transformPoint({x:vectorxyz.x, y:vectorxyz.y, z:0});
      else 
        vectoruv = transforms.transformPointz(vectorxyz);
    }
    if (!vectorxyz)
      vectorxyz = inverseTransformPointSimple(vectoruv);
    
    scene.center.x += vectorxyz.x;
    scene.center.y += vectorxyz.y;
    scene.center.u += vectoruv.u;
    scene.center.v += vectoruv.v;
    
    // move static sheets baseshadow
    moveBaseShadows(vectoruv);
  };
  function setCenter(vectorxyz, vectoruv) {
    if (!vectoruv) {
      if (!vectorxyz.z)
        vectoruv = transforms.transformPoint({x:vectorxyz.x, y:vectorxyz.y, z:0});
      else 
        vectoruv = transforms.transformPointz(vectorxyz);
    }
    if (!vectorxyz)
      vectorxyz = inverseTransformPointSimple(vectoruv);
      
    scene.center.x = vectorxyz.x;
    scene.center.y = vectorxyz.y;
    var diff = {u:vectoruv.u - scene.center.u, v: vectoruv.v - scene.center.v };
    scene.center.u = vectoruv.u;
    scene.center.v = vectoruv.v;
    
    // move static sheets baseshadow
    moveBaseShadows(diff);
  };
  function getUrlParams() {
    var e;
    var a = /\+/g;
    var r = /([^&=]+)=?([^&]*)/g;
    var d = function (s) { return decodeURIComponent(s.replace(a, " ")); };
    var q = window.location.search.substring(1);
    
    var urlParams = {};
    while (e = r.exec(q))
      urlParams[d(e[1])] = d(e[2]);
    return urlParams;
  };
  function getUrlLoadInfo() {
    var urlParams = scene.getUrlParams();
    return {yardcenter: {yardx:parseInt(urlParams.x), yardy:parseInt(urlParams.y)}};
  };
  function requestUrl(url, callback) {
    $.ajax({
      url: url,
      cache: false,
      dataType: "json",
      success: callback
    });
  };
  function getYards(urlBase, center, levelsize, appid, callback) {
    scene.yardcenterstart = {yardx:center.yardx, yardy:center.yardy};
    var url = urlBase + '/yard?x='+center.yardx+'&y='+center.yardy+'&levelsize='+levelsize+'&appid='+appid+'&appobjects=1';
    requestUrl(url, function(yardsAndObjects) {
      if (yardsAndObjects) {
        if (yardsAndObjects.center) {
          scene.yardcenterstart = {yardx:yardsAndObjects.center.x, yardy:yardsAndObjects.center.y};
          scene.yardcenter = {yardx:yardsAndObjects.center.x, yardy:yardsAndObjects.center.y};
          scene.level = yardsAndObjects.level;
        }
        objhelpers.defineAppObjects(yardsAndObjects.appobjects);
        sheetengine.objects = [];
        addYards(yardsAndObjects.yards, function(newsheets, newobjects) {
          callback();
        });
      } else {
        callback();
      }
    });
  };
  function getNewYards(urlBase, center, levelsize, appid, callback) {
    // gather yards to be removed and loaded
    var oldcenter = scene.yardcenter;
    scene.yardcenter = {yardx:center.yardx, yardy:center.yardy};
    var newcenter = scene.yardcenter;
  
    var oldc = {x1:oldcenter.yardx-levelsize,x2:oldcenter.yardx+levelsize,y1:oldcenter.yardy-levelsize,y2:oldcenter.yardy+levelsize};
    var newc = {x1:newcenter.yardx-levelsize,x2:newcenter.yardx+levelsize,y1:newcenter.yardy-levelsize,y2:newcenter.yardy+levelsize};
    
    // yards to remove
    var yardsToRemove = [];
    for (var x=oldc.x1;x<=oldc.x2;x++) {
      for (var y=oldc.y1;y<=oldc.y2;y++) {
        if (x < newc.x1 || x > newc.x2 ||
          y < newc.y1 || y > newc.y2)
          yardsToRemove.push({x:x,y:y});
      }
    }
    
    // yards to add
    var yardsToAdd = [];
    for (var x=newc.x1;x<=newc.x2;x++) {
      for (var y=newc.y1;y<=newc.y2;y++) {
        if (x < oldc.x1 || x > oldc.x2 ||
          y < oldc.y1 || y > oldc.y2)
          yardsToAdd.push({x:x,y:y});
      }
    }
    
  
    var yardsStr = '';
    for (var i=0;i<yardsToAdd.length;i++) {
      yardsStr += yardsToAdd[i].x+','+yardsToAdd[i].y;
      if (i < yardsToAdd.length-1)
        yardsStr += ';';
    }
    var url = urlBase + '/yard?x='+scene.yardcenterstart.yardx+'&y='+scene.yardcenterstart.yardy+'&yards='+yardsStr+'&appid='+appid+'&appobjects=0';
    requestUrl(url, function(yardsAndObjects) {
      var oldcenter2 = {x:oldcenter.yardx*scene.tilewidth, y:oldcenter.yardy*scene.tilewidth, z:0};
      var newcenter2 = {x:newcenter.yardx*scene.tilewidth, y:newcenter.yardy*scene.tilewidth, z:0};
      scene.translateBackground(oldcenter2, newcenter2);
  
      if (yardsAndObjects) {
        addYards(yardsAndObjects.yards, function(newsheets, newobjects) {
          var removedsheets = {sheets:[]};
          var removedobjects = {objects:[]};
          newYardsAdded(newsheets, removedsheets, removedobjects, yardsToRemove);
          callback(newsheets, newobjects, removedsheets.sheets, removedobjects.objects);
        });
      } else {
        var removedsheets = {sheets:[]};
        var removedobjects = {objects:[]};
        newYardsAdded(null, removedsheets, removedobjects, yardsToRemove);
        callback([], [], removedsheets.sheets, removedobjects.objects);
      }
    });
  };
  function removeYard(yard) {
    // remove yard sheets
    for (var s=0;s<yard.sheets.length;s++) {
      var sheet = yard.sheets[s];
      sheet.destroy();
      // var idx = sheetengine.sheets.indexOf(sheet);
      // if (idx != -1)
        // sheetengine.sheets.splice(idx,1);
    }
    
    // remove basesheet
    var bidx = sheetengine.basesheets.indexOf(yard.basesheet);
    if (bidx != -1)
      sheetengine.basesheets.splice(bidx,1);
      
    // remove yard objects
    for (var o=0;o<yard.objects.length;o++) {
      var obj = yard.objects[o];
      var idx = sheetengine.objects.indexOf(obj);
      if (idx != -1)
        sheetengine.objects.splice(idx,1);
      
      obj.destroy();
    }
  
    // remove yard
    delete loadedyards['x'+yard.x+'y'+yard.y];
  
    // adjust sheet indexes
    for (var i=0;i<sheetengine.sheets.length;i++) {
      sheetengine.sheets[i].index = i;
    }
  };
  function newYardsAdded(newsheets, removedsheets, removedobjects, yardsToRemove) {
    if (newsheets) {
      //moveBaseShadows(scene.center, newsheets);
    }
    // remove yard
    for (var i=0;i<yardsToRemove.length;i++) {
      var y = yardsToRemove[i];
      var key = 'x'+y.x+'y'+y.y;
      var yard = loadedyards[key];
      if (!yard)
        continue;
      removedsheets.sheets = removedsheets.sheets.concat(yard.sheets);
      removedobjects.objects = removedobjects.objects.concat(yard.objects);
      removeYard(yard);
    }
  };
  function getYardFromPos(centerp) {
    var yardx = Math.round(centerp.x / scene.tilewidth);
    var yardy = Math.round(centerp.y / scene.tilewidth);
    return {relyardx: yardx, relyardy: yardy, yardx: yardx + scene.yardcenterstart.yardx, yardy: yardy + scene.yardcenterstart.yardy};
  };
  function translateBackground(oldcenter, newcenter) {
    if (typeof(oldcenter.z) == 'undefined')
      oldcenter.z = 0;
    if (typeof(newcenter.z) == 'undefined')
      newcenter.z = 0;
    var oldcenteruv = transforms.transformPoint(oldcenter);
    var newcenteruv = transforms.transformPoint(newcenter);
    var transu = newcenteruv.u - oldcenteruv.u;
    var transv = newcenteruv.v - oldcenteruv.v;
    sheetengine.backgroundcontext.translate(-transu,-transv);
    shadows.baseshadowContext.translate(-transu,-transv);
    sheetengine.backgroundtranslate.u += transu;
    sheetengine.backgroundtranslate.v += transv;
  
    sheetengine.backgroundcontext.clearRect(sheetengine.backgroundtranslate.u,sheetengine.backgroundtranslate.v,sheetengine.backgroundcanvas.width,sheetengine.backgroundcanvas.height);
    shadows.baseshadowContext.clearRect(sheetengine.backgroundtranslate.u,sheetengine.backgroundtranslate.v,sheetengine.backgroundcanvas.width,sheetengine.backgroundcanvas.height);
  };
  
  scene.init = init;
  scene.initScene = initScene;
  scene.moveCenter = moveCenter;
  scene.setCenter = setCenter;
  scene.getUrlParams = getUrlParams;
  scene.getUrlLoadInfo = getUrlLoadInfo;
  scene.getYards = getYards;
  scene.getNewYards = getNewYards;
  scene.getYardFromPos = getYardFromPos;
  scene.translateBackground = translateBackground;
  
  // ===================================================================================================
  // geometry helper functions
  var geometry = {};
  sheetengine.geometry = geometry;
  
  function getBaseMatrixInverse(u,v,w) {
    // | u.x v.x w.x |-1             | w.z*v.y-v.z*w.y v.z*w.x-w.z*v.x w.y*v.x-v.y*w.x |
    // | u.y v.y w.y |    =  1/DET * | u.z*w.y-w.z*u.y w.z*u.x-u.z*w.x u.y*w.x-w.y*u.x |
    // | u.z v.z w.z |               | v.z*u.y-u.z*v.y u.z*v.x-v.z*u.x v.y*u.x-u.y*v.x |
    var det = u.x*(w.z*v.y-v.z*w.y)-u.y*(w.z*v.x-v.z*w.x)+u.z*(w.y*v.x-v.y*w.x);
    var b1 = { x: (w.z*v.y-v.z*w.y)/det, y:(u.z*w.y-w.z*u.y)/det, z:(v.z*u.y-u.z*v.y)/det };
    var b2 = { x: (v.z*w.x-w.z*v.x)/det, y:(w.z*u.x-u.z*w.x)/det, z:(u.z*v.x-v.z*u.x)/det };
    var b3 = { x: (w.y*v.x-v.y*w.x)/det, y:(u.y*w.x-w.y*u.x)/det, z:(v.y*u.x-u.y*v.x)/det };
    return {b1: b1, b2: b2, b3: b3};
  };
  function crossProduct(v1, v2) {
    return {x: (v1.z*v2.y)-(v1.y*v2.z),
        y: -(v1.z*v2.x)+(v1.x*v2.z),
        z: (v1.y*v2.x)-(v1.x*v2.y)};
  };
  function vectorMagnitude(v) {
    return Math.sqrt(v.x*v.x+v.y*v.y+v.z*v.z);
  };
  function round2digits(a, digits) {
    return Math.round(a * digits) / digits;
  };
  function roundVector2digits(v, digits) {
    return { x: round2digits(v.x, digits), y: round2digits(v.y, digits), z: round2digits(v.z, digits) };
  };
  function getTForSheetLineCrossing(normalp, centerp, p, l) {
    return (normalp.x*centerp.x + normalp.y*centerp.y + normalp.z*centerp.z - normalp.x*p.x - normalp.y*p.y - normalp.z*p.z) / (normalp.x*l.x + normalp.y*l.y + normalp.z*l.z);
  };
  function multiplyMatrices(a1,a2,a3,b1,b2,b3) {
    // ( a1.x  a2.x  a3.x )   ( b1.x  b2.x  b3.x )   ( a1.x*b1.x + a2.x*b1.y + a3.x*b1.z   a1.x*b2.x + a2.x*b2.y + a3.x*b2.z  a1.x*b3.x + a2.x*b3.y + a3.x*b3.z )
    // ( a1.y  a2.y  a3.y ) * ( b1.y  b2.y  b3.y ) = ( a1.y*b1.x + a2.y*b1.y + a3.y*b1.z   a1.y*b2.x + a2.y*b2.y + a3.y*b2.z  a1.y*b3.x + a2.y*b3.y + a3.y*b3.z )
    // ( a1.z  a2.z  a3.z )   ( b1.z  b2.z  b3.z )   ( a1.z*b1.x + a2.z*b1.y + a3.z*b1.z   a1.z*b2.x + a2.z*b2.y + a3.z*b2.z  a1.z*b3.x + a2.z*b3.y + a3.z*b3.z )
    var c1 = {x:a1.x*b1.x + a2.x*b1.y + a3.x*b1.z, y:a1.y*b1.x + a2.y*b1.y + a3.y*b1.z, z:a1.z*b1.x + a2.z*b1.y + a3.z*b1.z};
    var c2 = {x:a1.x*b2.x + a2.x*b2.y + a3.x*b2.z, y:a1.y*b2.x + a2.y*b2.y + a3.y*b2.z, z:a1.z*b2.x + a2.z*b2.y + a3.z*b2.z};
    var c3 = {x:a1.x*b3.x + a2.x*b3.y + a3.x*b3.z, y:a1.y*b3.x + a2.y*b3.y + a3.y*b3.z, z:a1.z*b3.x + a2.z*b3.y + a3.z*b3.z};
    return {c1: c1, c2: c2, c3: c3};
  };
  function getCoordsInBase(b, p) {
    var x = b.b1.x*p.x+b.b2.x*p.y+b.b3.x*p.z;
    var y = b.b1.y*p.x+b.b2.y*p.y+b.b3.y*p.z;
    var z = b.b1.z*p.x+b.b2.z*p.y+b.b3.z*p.z;
    return {x:x, y:y, z:z};
  };
  function getPointInBase(p, p1, p2, normalp) {
    return { 
      x: p.x*p1.x + p.y*p2.x + p.z*normalp.x,
      y: p.x*p1.y + p.y*p2.y + p.z*normalp.y,
      z: p.x*p1.z + p.y*p2.z + p.z*normalp.z };
  };
  function addPoint(p1, p2) {
    return { x:p1.x+p2.x, y:p1.y+p2.y, z:p1.z+p2.z };
  };
  function subPoint(p1, p2) {
    return { x:p1.x-p2.x, y:p1.y-p2.y, z:p1.z-p2.z };
  };
  function avgPoints(p1, p2, ratio1, ratio2, sum) {
    return { x:(p1.x*ratio1+p2.x*ratio2)/sum, y:(p1.y*ratio1+p2.y*ratio2)/sum, z:(p1.z*ratio1+p2.z*ratio2)/sum };
  };
  function avgPointsuv(p1, p2, ratio1, ratio2, sum) {
    return { u:(p1.u*ratio1+p2.u*ratio2)/sum, v:(p1.v*ratio1+p2.v*ratio2)/sum };
  };
  function roughPointDist(p1, p2) {
    return Math.abs(p1.x-p2.x) + Math.abs(p1.y-p2.y) + Math.abs(p1.z-p2.z);
  };
  function pointDist(p1, p2) {
    return geometry.vectorMagnitude({x:p2.x-p1.x,y:p2.y-p1.y,z:p2.z-p1.z});
  };
  function clonePoint(p) {
    return {x:p.x, y:p.y, z:p.z};
  };
  function normalPoint(p) {
    var max = Math.max(Math.abs(p.x),Math.max(Math.abs(p.y),Math.abs(p.z)));
    return {x:p.x/max, y:p.y/max, z:p.z/max};
  };
  function rotatePoint(p, phi, theta, omega) {
    var sphi = Math.sin(phi);
    var cphi = Math.cos(phi);
    var stheta = Math.sin(theta);
    var ctheta = Math.cos(theta);
    var somega = Math.sin(omega);
    var comega = Math.cos(omega);
    var x = p.x*ctheta*comega + p.y*ctheta*somega - p.z*stheta;
    var y = p.x*(-cphi*somega + sphi*stheta*comega) + p.y*(cphi*comega+sphi*stheta*somega) + p.z*sphi*ctheta;
    var z = p.x*(sphi*somega + cphi*stheta*comega) + p.y*(-sphi*comega+cphi*stheta*somega) + p.z*cphi*ctheta;
    return { x: x, y: y, z: z};
  };
  function inverseRPY(p1, p2, normalp) {
    var alpha = 0;
    var beta = 0;
    var gamma = 0;
    
    nz = p1.x;
    ny = p1.y;
    nx = p1.z;
    lz = p2.x;
    ly = p2.y;
    lx = p2.z;
    mz = normalp.x;
    my = normalp.y;
    mx = normalp.z;
    
    if (ly == 0 && lx == 0) {
      if (lz == 1) {
        beta = -Math.PI/2;
        alpha = 0;
        gamma = Math.atan2(ny,nx);
      }
      else {
        beta = Math.PI/2;
        alpha = 0;
        gamma = Math.atan2(mx,my);
      }
    }
    else {
      alpha = Math.atan2(ly,lx);
      var sa = Math.sin(alpha);
      var ca = Math.cos(alpha);
      beta = Math.atan2(-lz,sa*ly+ca*lx);
      gamma = Math.atan2(sa*nx-ca*ny, -sa*mx+ca*my);
    }
    alpha = alpha + Math.PI;
    beta = -beta;
    gamma = gamma + Math.PI;
    
    if (alpha == 2 * Math.PI)
      alpha = 0;
    if (gamma == 2 * Math.PI)
      gamma = 0;
    if (beta < 0)
      beta = 2 * Math.PI + beta;
    if (beta == 2 * Math.PI)
      beta = 0;

    var alphaD = Math.round(180/Math.PI * alpha);
    var betaD = Math.round(180/Math.PI * beta);
    var gammaD = Math.round(180/Math.PI * gamma);
    
    return { alpha: alpha, beta: beta, gamma: gamma, alphaD: alphaD, betaD: betaD, gammaD: gammaD };
  };
  function rotateAroundAxis(p, t, phi) {
    var cphi = Math.cos(phi);
    var sphi = Math.sin(phi);
    var tp = p.x*t.x + p.y*t.y + p.z*t.z;
    var txp = { x: t.y*p.z - p.y*t.z , y: - t.x*p.z + p.x*t.z , z: t.x*p.y - p.x*t.y };
    
    prot = {
      x: p.x*cphi + txp.x*sphi + t.x*(tp)*(1-cphi),
      y: p.y*cphi + txp.y*sphi + t.y*(tp)*(1-cphi),
      z: p.z*cphi + txp.z*sphi + t.z*(tp)*(1-cphi)
    };
    
    return prot;
  };
  function rotateAroundArbitraryAxis(p, tp, tv, phi) {
    var temp = { x: p.x-tp.x, y: p.y-tp.y, z: p.z-tp.z };
    var rottemp = geometry.rotateAroundAxis(temp, tv, phi);
    return { x: rottemp.x + tp.x, y: rottemp.y + tp.y, z: rottemp.z + tp.z };
  };
  function rotateAroundArbitraryAxisp(p, center, newcenter, tp, tv, phi) {
    var temp = { x: p.x+center.x, y: p.y+center.y, z: p.z+center.z };
    var rottemp = geometry.rotateAroundArbitraryAxis(temp, tp, tv, phi);
    return { x: rottemp.x-newcenter.x, y: rottemp.y-newcenter.y, z: rottemp.z-newcenter.z };
  };
  
  geometry.getBaseMatrixInverse = getBaseMatrixInverse;
  geometry.vectorMagnitude = vectorMagnitude; 
  geometry.getCoordsInBase = getCoordsInBase;
  geometry.getPointInBase = getPointInBase;
  geometry.addPoint = addPoint;
  geometry.subPoint = subPoint;
  geometry.pointDist = pointDist;
  geometry.clonePoint = clonePoint;
  geometry.normalPoint = normalPoint;
  geometry.rotatePoint = rotatePoint;
  geometry.inverseRPY = inverseRPY;
  geometry.rotateAroundAxis = rotateAroundAxis;
  geometry.rotateAroundArbitraryAxis = rotateAroundArbitraryAxis;
  geometry.rotateAroundArbitraryAxisp = rotateAroundArbitraryAxisp;
  
  
  // ===================================================================================================
  // transform functions
  var transforms = {};
  sheetengine.transforms = transforms;
  
  var su = Math.SQRT1_2;
  var sv = Math.SQRT1_2 / 2;
  
  function transformPoint(p) {
    var u = (p.x - p.y) * su;
    var v = (p.x + p.y) * sv  - p.z;
    return { u: u, v: v };
  };
  function transformPointz(p) {
    var u = (p.x - p.y) * su;
    var v = (p.x + p.y) * sv  - p.z;
    var z = -(p.x + p.y);
    return { u: u, v: v, z: z };
  };
  function transformPointuv(p, transformFunc, canvasCenter) {
    var puv = transformFunc(p);
    return { u: canvasCenter.u + puv.u, v: canvasCenter.v + puv.v };
  };
  function transformPointuvz(p, transformFunc, canvasCenter) {
    var puv = transformFunc(p);
    return { u: canvasCenter.u + puv.u, v: canvasCenter.v + puv.v, z: puv.z };
  };
  function inverseTransformPoint(p) {
    var su = Math.SQRT1_2;
    var sv = su / 2;
    
    var x = ((p.u - sheetengine.canvasCenter.u)/su + (p.v - sheetengine.canvasCenter.v)/sv) / 2;
    var y = (p.v - sheetengine.canvasCenter.v)/sv - x;
    return { x:Math.floor(x), y:Math.floor(y), z:null };
  };
  function inverseTransformPointSimple(p) {
    var su = Math.SQRT1_2;
    var sv = su / 2;
    
    var x = ((p.u)/su + (p.v)/sv) / 2;
    var y = (p.v)/sv - x;
    return { x:x, y:y, z:null };
  };
  
  transforms.transformPoint = transformPoint;
  transforms.transformPointz = transformPointz;
  transforms.transformPointuv = transformPointuv;
  transforms.transformPointuvz = transformPointuvz;
  transforms.inverseTransformPoint = inverseTransformPoint;
  
  
  // ===================================================================================================
  // object helpers
  var objhelpers = {};
  sheetengine.objhelpers = objhelpers;
  
  function drawObjectToScene(obj, centerpuv) {
    var u = Math.floor(centerpuv.u - obj.canvasSize.relu);
    var v = Math.floor(centerpuv.v - obj.canvasSize.relv);
    var w = obj.canvasSize.w;
    var h = obj.canvasSize.h;
    drawScenePart({
      viewPort: {u:u, v:v, w:w, h:h} 
    });
    var canvas = sheetengine.backgroundcanvas ? sheetengine.backgroundcanvas : sheetengine.canvas;
    var context = sheetengine.backgroundcanvas ? sheetengine.backgroundcontext : sheetengine.context;
    u += canvas.width/2;
    v += canvas.height/2;
    w-=1;  // fix drawing inaccuracies
    h-=1;
    if (sheetengine.drawObjectContour) {
      sheetengine.temppartcontext.strokeStyle = '#FFF';
      sheetengine.temppartcontext.strokeRect(0,0,w,h);
    }
    context.drawImage(sheetengine.temppartcanvas,0,0,w,h,u,v,w,h);
  };
  function defineAppObjects(appobjects) {
    sheetengine.appobjects = {};
    for (var i=0;i<appobjects.length;i++) {
      var obj = appobjects[i];
      sheetengine.appobjects[obj.name] = obj;
    }
  };
  function defineObject(name) {
    var obj = sheetengine.appobjects[name];
    if (!obj)
      return null;

    var createdSheets = [];
    for (var i=0;i<obj.sheets.length;i++) {
      var s = new sheetengine.Sheet(obj.sheets[i].centerp, obj.sheets[i].rot, {w:obj.sheets[i].width,h:obj.sheets[i].height});
      s.canvasdata = obj.sheets[i].canvas;
      createdSheets.push(s);
    }
  
    var canvasSize = obj.canvasSize;
    var createdObj = new sheetengine.SheetObject({x:0,y:0,z:0}, {alphaD:0,betaD:0,gammaD:0}, createdSheets, canvasSize, obj.intersectionsenabled);
    for (var i=0;i<createdSheets.length;i++) {
      createdSheets[i].objecttypehidden = obj.hidden;
    }
    
    createdObj.name = name;    // name for identifying object type
    return createdObj;
  };
  function fromRadian(a) {
    return a/Math.PI*180;
  };
  function fromDegree(a) {
    return a/180*Math.PI;
  };
  function fillRot(rot) {
    var newrot = {
      alpha:rot.alpha, beta:rot.beta, gamma:rot.gamma,
      alphaD:rot.alphaD, betaD:rot.betaD, gammaD:rot.gammaD};
      
    // fill radians if degrees are given
    if (typeof(newrot.alpha) === 'undefined')
      newrot.alpha = fromDegree(newrot.alphaD);
    if (typeof(newrot.beta) === 'undefined')
      newrot.beta = fromDegree(newrot.betaD);
    if (typeof(newrot.gamma) === 'undefined')
      newrot.gamma = fromDegree(newrot.gammaD);
    
    // fill degrees if radians are given
    if (typeof(newrot.alphaD) === 'undefined')
      newrot.alphaD = fromRadian(newrot.alpha);
    if (typeof(newrot.betaD) === 'undefined')
      newrot.betaD = fromRadian(newrot.beta);
    if (typeof(newrot.gammaD) === 'undefined')
      newrot.gammaD = fromRadian(newrot.gamma);
    
    return newrot;
  };
  function calcRotVector(rot, rotvectorstart) {
    var rotvector = [];
    rotvector[0] = geometry.rotatePoint(rotvectorstart[0], rot.alpha, rot.beta, rot.gamma);
    rotvector[1] = geometry.rotatePoint(rotvectorstart[1], rot.alpha, rot.beta, rot.gamma);
    rotvector[2] = geometry.rotatePoint(rotvectorstart[2], rot.alpha, rot.beta, rot.gamma);
    return rotvector;
  };
  function getThumbnailString(imgSrcPath, callback) {
    var i = document.createElement('img');
    var c = document.createElement('canvas');
    c.width = 16;
    c.height = 16;
    var ctx = c.getContext('2d');
    i.onload = function() {
      ctx.drawImage(i, 0,0);
      callback(c.toDataURL());
    }
    i.src = imgSrcPath;
  };
  function getCurrentSheetsObject() {
    if (sheetengine.currentSheet == -1)
      return {name:'my object', thumbnail:'', hidden:false, canvasSize:{w:0,h:0,relu:0,relv:0}, sheets:{}};
      
    var currentSheet = sheetengine.sheets[sheetengine.currentSheet];
    var group = currentSheet.group;
    var sheets = [];
    if (typeof(group) !== 'undefined' && group !== null) {
      for (var i=0;i<sheetengine.sheets.length;i++) {
        var s = sheetengine.sheets[i];
        if (s.group != group)
          continue;
        
        sheets.push({
          centerp: s.centerp,
          rot: {alphaD:s.rot.alphaD, betaD:s.rot.betaD, gammaD:s.rot.gammaD},
          width: s.width, 
          height: s.height, 
          canvas: s.canvas.toDataURL()
        });
      } 
    } else {
      var s = currentSheet;
      sheets.push({
        centerp: s.centerp,
        rot: {alphaD:s.rot.alphaD, betaD:s.rot.betaD, gammaD:s.rot.gammaD},
        width: s.width, 
        height: s.height, 
        canvas: s.canvas.toDataURL()
      });
    }
  
    var maxdist = 0;
    for (var i=0;i<sheets.length;i++) {
      var sheet = sheets[i];
      var w2 = sheet.width/2;
      var h2 = sheet.height/2;
      var dist = Math.sqrt(w2*w2+h2*h2) + pointDist(sheet.centerp, {x:0,y:0,z:0});
      if (dist > maxdist)
        maxdist = dist;
    }
    var w = Math.round(maxdist * 2);
    var h = w;
    var relu = Math.round(maxdist);
    var relv = Math.round(maxdist);

    var canvasSize = {w:w, h:h, relu:relu, relv:relv};
  
    return {name:'my object', thumbnail:'', hidden:false, intersectionsenabled:true, canvasSize:canvasSize, sheets:sheets};
  };
  function getCurrentSheetsObjectStr() {
    var retobj = getCurrentSheetsObject();
    return JSON.stringify(retobj);
  };
  function redefineIntersections(obj) {
    // redefine polygons
    for (var i=0;i<obj.sheets.length;i++) {
      calculateSheetSections(obj.sheets[i], true, obj.sheets);
    }
  
    // calculate initial polygons from the redefined current polygonset
    for (var i=0;i<obj.sheets.length;i++) {
      var s = obj.sheets[i];
      s.startpolygons = [];
      var A1 = sheetengine.geometry.getBaseMatrixInverse(s.p1start, s.p2start, s.normalpstart);
      for (var j=0;j<s.polygons.length;j++) {
        var poly = s.polygons[j];
        var points = [];
        var relpoints = [];
        for (var p=0;p<poly.points.length;p++) {
          var sp = geometry.subPoint(poly.points[p], obj.centerp);
          sp = geometry.rotatePoint(sp,-obj.rot.alpha,-obj.rot.beta,-obj.rot.gamma);
          //startpoly.points.push(sp);
          points.push(sp);
          var relp = sheetengine.geometry.getCoordsInBase(A1, sp);
          relpoints.push(relp);
        }
        s.startpolygons.push({points:points, relpoints:relpoints});
        s.startpolygonscenterp = geometry.clonePoint(s.startcenterp);
      }
    }
  };
  
  objhelpers.fillRot = fillRot;
  objhelpers.defineAppObjects = defineAppObjects;
  objhelpers.defineObject = defineObject;
  objhelpers.getThumbnailString = getThumbnailString;
  objhelpers.getCurrentSheetsObject = getCurrentSheetsObject;
  objhelpers.getCurrentSheetsObjectStr = getCurrentSheetsObjectStr;
  
    
  // ===================================================================================================
  // BaseSheet
  sheetengine.BaseSheet = function(centerp, rot, size) {
    var rotclone = objhelpers.fillRot(rot);

    this.width = size.w;
    this.height = size.h;
    this.centerp = geometry.clonePoint(centerp);
    this.rot = {alphaD:rotclone.alphaD, betaD:rotclone.betaD, gammaD:rotclone.gammaD};

    calc.defineSheetParams(this);
    calc.limitToCorners(this);    
    calc.calculateSheetData(this);
    shadows.calculateSheetShade(this);
  
    sheetengine.basesheets.push(this);
  };
  sheetengine.BaseSheet.prototype.destroy = function() {
    var bidx = sheetengine.basesheets.indexOf(this);
    if (bidx != -1)
      sheetengine.basesheets.splice(bidx,1);
  };
  
  // ===================================================================================================
  // Sheet
  sheetengine.Sheet = function(centerp, rot, size) {
    var rotclone = objhelpers.fillRot(rot);

    this.width = size.w;
    this.height = size.h;
    this.centerp = geometry.clonePoint(centerp);
    this.rot = {alphaD:rotclone.alphaD, betaD:rotclone.betaD, gammaD:rotclone.gammaD};
    
    this.objectsheet = false;    // by default sheet is not part of an object. this is set by SheetObject constructor
    this.skipDensityMap = false;  // sheet will be added to densitymap if DensityMap.addSheet is called
    this.dimSheets = false;      // sheet will not dim other sheets
    this.dimmingDisabled = false;  // sheet will be dimmed by other sheets
    this.hidden = false;      // sheet will be drawn to main canvas and takes part in calculations
    this.dirty = false;        // indicates if sheet data needs to be recalculated (eg. after moving/rotating sheet)
    this.canvasdirty = true;  

    this.dimmed = 0;
    this.dimmedprev = 0;
  
    this.castshadows = true;
    this.allowshadows = true;
    
    this.canvas = drawing.createCanvas(this.width, this.height);
    this.context = this.canvas.getContext('2d');
    this.shadowcanvas = drawing.createCanvas(this.width, this.height);
    this.shadowcontext = this.shadowcanvas.getContext('2d');
    this.shadowtempcanvas = drawing.createCanvas(this.width, this.height);
    this.shadowtempcontext = this.shadowtempcanvas.getContext('2d');
    this.baseshadowcanvas = drawing.createCanvas(this.width, this.height);
    this.baseshadowcontext = this.baseshadowcanvas.getContext('2d');
    this.compositecanvas = drawing.createCanvas(this.width, this.height);
    this.compositecontext = this.compositecanvas.getContext('2d');
    
    calc.defineSheetParams(this);
    calc.limitToCorners(this);    
    calc.calculateSheetData(this);
    shadows.calculateSheetShade(this);
  
    this.index = sheetengine.sheets.length;
    sheetengine.sheets.push(this);
    staticsheets = null;  // mark staticsheets for recollecting
  };
  sheetengine.Sheet.prototype.canvasChanged = function() {
    this.canvasdirty = true;
    if (this.objectsheet) {
      this.object.canvasdirty = true;
      this.object.intersectionsrecalc = true;
    }
    this.dirty = true;
  };
  sheetengine.Sheet.prototype.destroy = function() {
    this.hidden = true;
    this.dirty = true;
    this.deleting = true;
    sheetengine.sheetsbeingdeleted = true;
  };
  sheetengine.Sheet.prototype.refreshCanvas = function() {
    if (!this.canvasdirty)
    return;
    
    this.compositecontext.clearRect(0, 0, this.width, this.height);
    drawing.redrawSheetCanvases(this);
    this.canvasdirty = false;
  };
  sheetengine.Sheet.prototype.setShadows = function(castshadows, allowshadows) {
    this.castshadows = castshadows;
    if (this.allowshadows != allowshadows) {
      this.allowshadows = allowshadows;
      shadows.calculateSheetShade(this);
    }
    this.dirty = true;
  };
  sheetengine.Sheet.prototype.setDimming = function(dimSheets, dimmingDisabled) {
    this.dimSheets = dimSheets;
    this.dimmingDisabled = dimmingDisabled;
    this.dirty = true;
  };
  
  // ===================================================================================================
  // SheetObject
  sheetengine.SheetObject = function(centerp, rot, sheets, canvasSize, intersectionsenabled) {
    for (var i=0;i<sheets.length;i++) {
      var s = sheets[i];
      s.objectsheet = true;    // indicate that sheet is part of an object
      s.object = this;
    
      s.startcenterp = {x:s.centerp.x,y:s.centerp.y,z:s.centerp.z};
      s.rotcenterp = {x:s.centerp.x,y:s.centerp.y,z:s.centerp.z};
      s.centerp.x += centerp.x;
      s.centerp.y += centerp.y;
      s.centerp.z += centerp.z;
      
      s.intersectionParams = [];
    
      calc.calculateSheetData(s);  // need to calc before setting up initial polygons
    }

    this.intersectionsenabled = intersectionsenabled ? true : false;  // by default an object will not intersect static sheets or other objects

    if (!sheetengine.objectsintersect && !this.intersectionsenabled) {
      for (var i=0;i<sheets.length;i++) {
        calculateSheetSections(sheets[i], true, sheets);
      }
      for (var i=0;i<sheets.length;i++) {
        var s = sheets[i];
        var startpoly = [];
        var A1 = sheetengine.geometry.getBaseMatrixInverse(s.p1start, s.p2start, s.normalpstart);
        for (var j=0;j<s.polygons.length;j++) {
          var poly = s.polygons[j];
          var points = [];
          var relpoints = [];
          for (var p=0;p<poly.points.length;p++) {
            var pp = geometry.subPoint(poly.points[p], centerp);
            points.push(pp);
            var relp = sheetengine.geometry.getCoordsInBase(A1, pp);
            relpoints.push(relp);
          }
          startpoly.push({points:points, relpoints:relpoints});
        }
        s.startpolygons = startpoly;
        s.startpolygonscenterp = geometry.clonePoint(s.startcenterp);
      }
    }

    this.centerp = centerp;
    this.rot = objhelpers.fillRot(rot);
    this.rotvectorstart = [{x:1,y:0,z:0},{x:0,y:0,z:-1},{x:0,y:1,z:0}];
    this.rotvector = calcRotVector(this.rot, this.rotvectorstart);
    this.sheets = sheets;
    this.hidden = false;
    this.intersectionsredefine = false;
    this.intersectionsrecalc = false;
  
    // object canvas size
    this.canvasSize = canvasSize;
  
    // adjust temppartcanvas size if necessary
    if (canvasSize.w > sheetengine.tempCanvasSize.w || canvasSize.h > sheetengine.tempCanvasSize.h) {
      var w = Math.max(canvasSize.w, sheetengine.tempCanvasSize.w);
      var h = Math.max(canvasSize.h, sheetengine.tempCanvasSize.h);
      sheetengine.tempCanvasSize = {w:w,h:h};
      sheetengine.temppartcanvas.width = w;
      sheetengine.temppartcanvas.height = h;
      sheetengine.temppartshadowcanvas.width = w;
      sheetengine.temppartshadowcanvas.height = h;
    }
  
    // set oldcenterp for redrawing old positions
    this.oldcenterp = clonePoint(this.centerp);

    this.centerpuv = transforms.transformPoint(this.centerp);
    this.centerpuvrel = transforms.transformPointuvz(this.centerp, transforms.transformPointz, sheetengine.canvasCenter);
    this.oldcenterpuv = transforms.transformPoint(this.oldcenterp);

    this.setOrientation(this.rot);
    sheetengine.objects.push(this);
  };
  sheetengine.SheetObject.prototype.setDimming = function(dimSheets, dimmingDisabled) {
    for (var i=0;i<this.sheets.length;i++) {
      var s = this.sheets[i];
      s.dimSheets = dimSheets;
      s.dimmingDisabled = dimmingDisabled;
      s.dirty = true;
    }
    this.intersectionsrecalc = true;
    this.canvasdirty = true;
  };
  sheetengine.SheetObject.prototype.setShadows = function(castshadows, allowshadows) {
    for (var i=0;i<this.sheets.length;i++) {
      var s = this.sheets[i];
      s.setShadows(castshadows, allowshadows);
    }
    this.intersectionsrecalc = true;
    this.canvasdirty = true;
  };
  sheetengine.SheetObject.prototype.setCollision = function(collisionEnabled) {
    for (var i=0;i<this.sheets.length;i++) {
      var s = this.sheets[i];
      s.skipDensityMap = !collisionEnabled;
    }
  };
  sheetengine.SheetObject.prototype.destroy = function() {
    this.hide();
    for (var s=0;s<this.sheets.length;s++) {
      var sheet = this.sheets[s];
      sheet.deleting = true;
    }
    sheetengine.sheetsbeingdeleted = true;
    this.deleting = true;
  };
  sheetengine.SheetObject.prototype.setPosition = function(pos) {
    this.move(pos, true);
  };
  sheetengine.SheetObject.prototype.move = function(vector, base) {
    this.oldcenterp = clonePoint(this.centerp);  // set oldcenterp to previous centerp - before setting new centerp
    if (base) {
      this.centerp.x = vector.x;
      this.centerp.y = vector.y;
      this.centerp.z = vector.z;
    } else {
      this.centerp.x += vector.x;
      this.centerp.y += vector.y;
      this.centerp.z += vector.z;
    }
  
    var diffx = this.centerp.x - this.oldcenterp.x;
    var diffy = this.centerp.y - this.oldcenterp.y;
    var diffz = this.centerp.z - this.oldcenterp.z;
    
    for (var i=0;i<this.sheets.length;i++) {
      var s = this.sheets[i];

      s.centerp.x = s.rotcenterp.x + this.centerp.x;
      s.centerp.y = s.rotcenterp.y + this.centerp.y;
      s.centerp.z = s.rotcenterp.z + this.centerp.z;

      calc.calculateSheetData(s);
    
      if (s.polygons && !sheetengine.objectsintersect && !this.intersectionsenabled) {
        for (var j=0;j<s.polygons.length;j++) {
          var poly = s.polygons[j];
          for (var p=0;p<poly.points.length;p++) {
            var pp = poly.points[p];
            pp.x += diffx;
            pp.y += diffy;
            pp.z += diffz;
          }
        }
      }
    }
  
    this.centerpuv = transforms.transformPoint(this.centerp);
    this.centerpuvrel = transforms.transformPointuvz(this.centerp, transforms.transformPointz, sheetengine.canvasCenter);
    this.oldcenterpuv = transforms.transformPoint(this.oldcenterp);
  
    this.intersectionsrecalc = true;
    this.canvasdirty = true;
  };
  sheetengine.SheetObject.prototype.rotateBase = function(axis, angle) {
    this.rotate(axis, angle, true);
  };
  sheetengine.SheetObject.prototype.rotate = function(axis, angle, base) {
    // set object orientation angles and vector
    if (base) {
      this.rotvector[0] = geometry.rotateAroundAxis(this.rotvectorstart[0],axis,angle);
      this.rotvector[1] = geometry.rotateAroundAxis(this.rotvectorstart[1],axis,angle);
      this.rotvector[2] = geometry.rotateAroundAxis(this.rotvectorstart[2],axis,angle);
    } else {
      this.rotvector[0] = geometry.rotateAroundAxis(this.rotvector[0],axis,angle);
      this.rotvector[1] = geometry.rotateAroundAxis(this.rotvector[1],axis,angle);
      this.rotvector[2] = geometry.rotateAroundAxis(this.rotvector[2],axis,angle);
    }
    // calc rot with inverserpy
    this.rot = geometry.inverseRPY(this.rotvector[0], this.rotvector[1], this.rotvector[2]);
    
    for (var i=0;i<this.sheets.length;i++) {
      var s = this.sheets[i];
      
      if (base) {
        s.p0 = geometry.rotateAroundAxis(s.p0start,axis,angle);
        s.p1 = geometry.rotateAroundAxis(s.p1start,axis,angle);
        s.p2 = geometry.rotateAroundAxis(s.p2start,axis,angle);
        s.normalp = geometry.rotateAroundAxis(s.normalpstart,axis,angle);
        s.rotcenterp = geometry.rotateAroundAxis(s.startcenterp,axis,angle);

        if (s.startpolygons && !sheetengine.objectsintersect && !this.intersectionsenabled) {
          s.polygons = [];
          for (var j=0;j<s.startpolygons.length;j++) {
            var poly = { points:[] };
            s.polygons.push(poly);
            var startpoly = s.startpolygons[j];
            for (var p=0;p<startpoly.points.length;p++) {
              var pp = geometry.rotateAroundAxis(startpoly.points[p], axis, angle);
              poly.points.push(geometry.addPoint(pp, this.centerp));
            }
          }
        }

      } else {
        s.p0 = geometry.rotateAroundAxis(s.p0,axis,angle);
        s.p1 = geometry.rotateAroundAxis(s.p1,axis,angle);
        s.p2 = geometry.rotateAroundAxis(s.p2,axis,angle);
        s.normalp = geometry.rotateAroundAxis(s.normalp,axis,angle);
        s.rotcenterp = geometry.rotateAroundAxis(s.rotcenterp,axis,angle);
    
        if (s.polygons && !sheetengine.objectsintersect && !this.intersectionsenabled) {
          for (var j=0;j<s.polygons.length;j++) {
            var poly = s.polygons[j];
            for (var p=0;p<poly.points.length;p++) {
              var pp = geometry.subPoint(poly.points[p], this.centerp);
              pp = geometry.rotateAroundAxis(pp,axis,angle);
              poly.points[p] = geometry.addPoint(pp,this.centerp);
            }
          }
        }

      }

      s.centerp.x = s.rotcenterp.x + this.centerp.x;
      s.centerp.y = s.rotcenterp.y + this.centerp.y;
      s.centerp.z = s.rotcenterp.z + this.centerp.z;

      calc.calculateSheetData(s);
      shadows.calculateSheetShade(s);
    }
  
    this.intersectionsrecalc = true;
    this.canvasdirty = true;
  };
  sheetengine.SheetObject.prototype.setOrientation = function(rot) {
    this.rot = objhelpers.fillRot(rot);
    this.rotvector = calcRotVector(this.rot, this.rotvectorstart);
    
    for (var i=0;i<this.sheets.length;i++) {
      var s = this.sheets[i];
      
      s.p0 = geometry.rotatePoint(s.p0start, this.rot.alpha, this.rot.beta, this.rot.gamma);
      s.p1 = geometry.rotatePoint(s.p1start, this.rot.alpha, this.rot.beta, this.rot.gamma);
      s.p2 = geometry.rotatePoint(s.p2start, this.rot.alpha, this.rot.beta, this.rot.gamma);
      s.normalp = geometry.rotatePoint(s.normalpstart, this.rot.alpha, this.rot.beta, this.rot.gamma);
      
      s.rotcenterp = geometry.rotatePoint(s.startcenterp, this.rot.alpha, this.rot.beta, this.rot.gamma);

      s.centerp.x = s.rotcenterp.x + this.centerp.x;
      s.centerp.y = s.rotcenterp.y + this.centerp.y;
      s.centerp.z = s.rotcenterp.z + this.centerp.z;
      
      calc.calculateSheetData(s);
      shadows.calculateSheetShade(s);

      if (s.startpolygons && !sheetengine.objectsintersect && !this.intersectionsenabled) {
        s.polygons = [];
        for (var j=0;j<s.startpolygons.length;j++) {
          var poly = { points:[] };
          s.polygons.push(poly);
          var startpoly = s.startpolygons[j];
          for (var p=0;p<startpoly.points.length;p++) {
            var pp = geometry.rotatePoint(startpoly.points[p], this.rot.alpha, this.rot.beta, this.rot.gamma);
            poly.points.push(geometry.addPoint(pp, this.centerp));
          }
        }
      }
    }
  
    this.intersectionsrecalc = true;
    this.canvasdirty = true;
  };
  sheetengine.SheetObject.prototype.setSheetPos = function(sheet, sheetpos, sheetrot) {
    var s = sheet;
    
    var sheetrot2 = objhelpers.fillRot(sheetrot);
    
    //var sheetdiffp = geometry.subPoint(sheetpos, s.startcenterp);
    //var oldcenterp = s.startcenterp;
  
    // set sheet position
    s.startcenterp = sheetpos;
    
    // set sheet rotation relative to object
    s.p0start = geometry.rotatePoint(s.p0orig,sheetrot2.alpha,sheetrot2.beta,sheetrot2.gamma);
    s.p1start = geometry.rotatePoint(s.p1orig,sheetrot2.alpha,sheetrot2.beta,sheetrot2.gamma);
    s.p2start = geometry.rotatePoint(s.p2orig,sheetrot2.alpha,sheetrot2.beta,sheetrot2.gamma);
    s.normalpstart = geometry.rotatePoint(s.normalporig,sheetrot2.alpha,sheetrot2.beta,sheetrot2.gamma);
    
    // recorrect initial polygons
    if (s.startpolygons && !sheetengine.objectsintersect && !this.intersectionsenabled) {
      var diffp = geometry.subPoint(sheetpos, s.startpolygonscenterp);
      for (var j=0;j<s.startpolygons.length;j++) {
        var startpoly = s.startpolygons[j];
        for (var p=0;p<startpoly.points.length;p++) {
          var relp = startpoly.relpoints[p];
          startpoly.points[p] = geometry.getPointInBase(relp, s.p1start, s.p2start, s.normalpstart);
          startpoly.points[p] = geometry.addPoint(startpoly.points[p], diffp);
      
          // startpoly.points[p] = geometry.addPoint(startpoly.points[p], sheetdiffp);
          // startpoly.relpoints[p] = geometry.addPoint(startpoly.relpoints[p], sheetdiffp);
        }
      }
    }
  
    // set absolute sheet rotation and position modified with object rotation and position
    var rot = this.rot;
    s.p0 = geometry.rotatePoint(s.p0start, rot.alpha, rot.beta, rot.gamma);
    s.p1 = geometry.rotatePoint(s.p1start, rot.alpha, rot.beta, rot.gamma);
    s.p2 = geometry.rotatePoint(s.p2start, rot.alpha, rot.beta, rot.gamma);
    s.normalp = geometry.rotatePoint(s.normalpstart, rot.alpha, rot.beta, rot.gamma);
    s.rotcenterp = geometry.rotatePoint(s.startcenterp, rot.alpha, rot.beta, rot.gamma);
    
    s.centerp.x = s.rotcenterp.x + this.centerp.x;
    s.centerp.y = s.rotcenterp.y + this.centerp.y;
    s.centerp.z = s.rotcenterp.z + this.centerp.z;
    
    calc.calculateSheetData(s);
    shadows.calculateSheetShade(s);

    // recorrect current polygons
    if (s.startpolygons && !sheetengine.objectsintersect && !this.intersectionsenabled) {
      s.polygons = [];
      for (var j=0;j<s.startpolygons.length;j++) {
        var poly = { points:[] };
        s.polygons.push(poly);
        var startpoly = s.startpolygons[j];
        for (var p=0;p<startpoly.points.length;p++) {
          var pp = geometry.rotatePoint(startpoly.points[p], this.rot.alpha, this.rot.beta, this.rot.gamma);
          poly.points.push(geometry.addPoint(pp, this.centerp));
        }
      }
    }
  
    this.intersectionsrecalc = true;
    this.canvasdirty = true;
  };
  sheetengine.SheetObject.prototype.rotateSheet = function(sheet, rotationCenter, rotationAxis, angle) {
    var s = sheet;
  
    // recorrect initial polygons
    if (s.startpolygons && !sheetengine.objectsintersect && !this.intersectionsenabled) {
      for (var j=0;j<s.startpolygons.length;j++) {
        var startpoly = s.startpolygons[j];
        for (var p=0;p<startpoly.points.length;p++) {
          startpoly.points[p] = geometry.rotateAroundArbitraryAxis(startpoly.points[p],rotationCenter,rotationAxis,angle);
        }
      }
    }
  
    s.p0start = geometry.rotateAroundAxis(s.p0start,rotationAxis,angle);
    s.p1start = geometry.rotateAroundAxis(s.p1start,rotationAxis,angle);
    s.p2start = geometry.rotateAroundAxis(s.p2start,rotationAxis,angle);
    s.normalpstart = geometry.rotateAroundAxis(s.normalpstart,rotationAxis,angle);
    s.startcenterp = geometry.rotateAroundArbitraryAxis(s.startcenterp,rotationCenter,rotationAxis,angle);
  
    // rotationCenter and rotationAxis are given relatively to object orientation
    rotationCenter = geometry.rotatePoint(rotationCenter, this.rot.alpha, this.rot.beta, this.rot.gamma);
    rotationAxis = geometry.rotatePoint(rotationAxis, this.rot.alpha, this.rot.beta, this.rot.gamma);
  
    s.p0 = geometry.rotateAroundAxis(s.p0,rotationAxis,angle);
    s.p1 = geometry.rotateAroundAxis(s.p1,rotationAxis,angle);
    s.p2 = geometry.rotateAroundAxis(s.p2,rotationAxis,angle);
    s.normalp = geometry.rotateAroundAxis(s.normalp,rotationAxis,angle);
    s.rotcenterp = geometry.rotateAroundArbitraryAxis(s.rotcenterp,rotationCenter,rotationAxis,angle);

    s.centerp.x = s.rotcenterp.x + this.centerp.x;
    s.centerp.y = s.rotcenterp.y + this.centerp.y;
    s.centerp.z = s.rotcenterp.z + this.centerp.z;

    calc.calculateSheetData(s);
    shadows.calculateSheetShade(s);

    // recorrect current polygons
    if (s.startpolygons && s.polygons && !sheetengine.objectsintersect && !this.intersectionsenabled) {
      s.polygons = [];
      for (var j=0;j<s.startpolygons.length;j++) {
        var poly = { points:[] };
        s.polygons.push(poly);
        var startpoly = s.startpolygons[j];
        for (var p=0;p<startpoly.points.length;p++) {
          var pp = geometry.rotatePoint(startpoly.points[p], this.rot.alpha, this.rot.beta, this.rot.gamma);
          poly.points.push(geometry.addPoint(pp, this.centerp));
        }
      }
    }
  
    this.intersectionsrecalc = true;
    this.canvasdirty = true;
  };
  sheetengine.SheetObject.prototype.redefineIntersections = function() {
    this.intersectionsredefine = true;
  };
  sheetengine.SheetObject.prototype.show = function() {
    for (var i=0;i<this.sheets.length;i++) {
      this.sheets[i].hidden = false;
      this.sheets[i].dirty = true;
    }
    this.hidden = false;
    this.intersectionsrecalc = true;
    this.canvasdirty = true;
  };
  sheetengine.SheetObject.prototype.hide = function() {
    for (var i=0;i<this.sheets.length;i++) {
      this.sheets[i].hidden = true;
      this.sheets[i].dirty = true;
    }
    this.hidden = true;
    this.intersectionsrecalc = true;
    this.canvasdirty = true;
  };
  sheetengine.SheetObject.prototype.getString = function() {
    // sheets
    var sheets = [];
    for (var i=0;i<this.sheets.length;i++) {
      var s = this.sheets[i];
      
      sheets.push({
        centerp: s.centerp,
        rot: {alphaD:s.rot.alphaD, betaD:s.rot.betaD, gammaD:s.rot.gammaD},
        width: s.width, 
        height: s.height, 
        canvas: s.canvas.toDataURL()
      });
    }
    var retobj = {name:'my object', thumbnail:'', hidden:false, intersectionsenabled: this.intersectionsenabled, canvasSize:this.canvasSize, sheets:sheets};
    return JSON.stringify(retobj);
  };
  sheetengine.SheetObject.prototype.draw = function() {
    if (!this.canvasdirty)
      return;

    var centerpuv = this.centerpuv;
    var oldcenterpuv = this.oldcenterpuv;

    // check if old position is close enough to be refreshed in one step
    var du = Math.ceil(Math.abs(centerpuv.u - oldcenterpuv.u) + this.canvasSize.w);
    var dv = Math.ceil(Math.abs(centerpuv.v - oldcenterpuv.v) + this.canvasSize.h);

    var fit = (du < sheetengine.temppartcanvas.width && dv < sheetengine.temppartcanvas.height);
    if (fit) {
      // update old + new location using temppartcanvas
      var u = Math.floor(Math.min(centerpuv.u, oldcenterpuv.u) - this.canvasSize.relu);
      var v = Math.floor(Math.min(centerpuv.v, oldcenterpuv.v) - this.canvasSize.relv);
      var w = du;
      var h = dv;
      drawScenePart({
        viewPort: {u:u, v:v, w:w, h:h} 
      });
      var canvas = sheetengine.backgroundcanvas ? sheetengine.backgroundcanvas : sheetengine.canvas;
      var context = sheetengine.backgroundcanvas ? sheetengine.backgroundcontext : sheetengine.context;
      u += canvas.width/2;
      v += canvas.height/2;
      w-=1;  // fix drawing inaccuracies
      h-=1;
      context.drawImage(sheetengine.temppartcanvas,0,0,w,h,u,v,w,h);
    
      if (sheetengine.drawObjectContour) {
        context.strokeStyle = '#FFF';
        context.strokeRect(centerpuv.u-this.canvasSize.relu+canvas.width/2,centerpuv.v-this.canvasSize.relv+canvas.height/2,this.canvasSize.w,this.canvasSize.h);
      }
    } else {
      // update old + new location separately
      drawObjectToScene(this, oldcenterpuv);
      drawObjectToScene(this, centerpuv);
    }

    this.canvasdirty = false;
  
    if (this.deleting)
      deleteObject(this);
  };
  
  // ===================================================================================================
  // DensityMap  
  sheetengine.DensityMap = function(granularity) {
    this.map = {};
    this.granularity = granularity;
  };
  sheetengine.DensityMap.prototype.get = function(p) {
    var map = this.map;
    var gran = this.granularity;
    var x = Math.round(p.x / gran);
    var y = Math.round(p.y / gran);
    var z = Math.round(p.z / gran);

    if (map['x'+x+'y'+y+'z'+z])
      return map['x'+x+'y'+y+'z'+z];
      
    return 0;
  };
  sheetengine.DensityMap.prototype.put = function(p) {
    var map = this.map;
    var gran = this.granularity;
    var x = Math.round(p.x / gran);
    var y = Math.round(p.y / gran);
    var z = Math.floor(p.z / gran);
    
    this.add('x'+x+'y'+y+'z'+z);
    // make sure no empty diagonals are left
    this.add('x'+(x+1)+'y'+(y)+'z'+(z));
    this.add('x'+(x)+'y'+(y+1)+'z'+(z));
    this.add('x'+(x-1)+'y'+(y)+'z'+(z));
    this.add('x'+(x)+'y'+(y-1)+'z'+(z));
  };
  sheetengine.DensityMap.prototype.remove = function(p) {
    var map = this.map;
    var gran = this.granularity;
    var x = Math.round(p.x / gran);
    var y = Math.round(p.y / gran);
    var z = Math.floor(p.z / gran);
    
    this.sub('x'+x+'y'+y+'z'+z);
    // make sure no empty diagonals are left
    this.sub('x'+(x+1)+'y'+(y)+'z'+(z));
    this.sub('x'+(x)+'y'+(y+1)+'z'+(z));
    this.sub('x'+(x-1)+'y'+(y)+'z'+(z));
    this.sub('x'+(x)+'y'+(y-1)+'z'+(z));
  };
  sheetengine.DensityMap.prototype.add = function(id) {
    var map = this.map;
    if (!map[id])
      map[id] = 1;
    else 
      map[id] = map[id] + 1;
  };
  sheetengine.DensityMap.prototype.sub = function(id) {
    var map = this.map;
    if (!map[id] || map[id] == 0)
      return;
    else 
      map[id] = map[id] - 1;
  };
  sheetengine.DensityMap.prototype.addSheet = function(sheet) {
    this.processSheet(sheet, this.put);
  };
  sheetengine.DensityMap.prototype.removeSheet = function(sheet) {
    this.processSheet(sheet, this.remove);
  };
  sheetengine.DensityMap.prototype.processSheet = function(sheet, processFunction) {
    var gran = this.granularity;
    var s = sheet;
    if (s.skipDensityMap)
      return;
    var granx = Math.round(s.width / gran);
    var grany = Math.round(s.height / gran);
    var xmod = {
      x: (s.corners[1].x - s.corners[0].x) / granx,
      y: (s.corners[1].y - s.corners[0].y) / granx,
      z: (s.corners[1].z - s.corners[0].z) / granx };
    var ymod = {
      x: (s.corners[3].x - s.corners[0].x) / grany,
      y: (s.corners[3].y - s.corners[0].y) / grany,
      z: (s.corners[3].z - s.corners[0].z) / grany };
    
    var w = s.canvas.width;
    var h = s.canvas.height;
    var imgData = s.context.getImageData(0, 0, w, h).data;
    var actp = geometry.clonePoint(geometry.addPoint(s.corners[0], {x:(xmod.x+ymod.x)/2, y:(xmod.y+ymod.y)/2, z:(xmod.z+ymod.z)/2}));
    for (var y=0;y<grany;y++) {
      actpx = geometry.clonePoint(actp);
      for (var x=0;x<granx;x++) {
        var sx = Math.round(x*gran+gran/2);
        var sy = Math.round(y*gran+gran/2);
        var pixi = (sx + w * sy) * 4;
        var alpha = imgData[pixi+3];
        if (alpha != 0) {
          processFunction.call(this, actpx);
        }
        actpx = geometry.addPoint(actpx,xmod);
      }
      actp = geometry.addPoint(actp,ymod);
    }
  };
  sheetengine.DensityMap.prototype.addSheets = function(sheets) {
    for (var i=0;i<sheets.length;i++) {
      this.addSheet(sheets[i]);
    }
  };
  sheetengine.DensityMap.prototype.removeSheets = function(sheets) {
    for (var i=0;i<sheets.length;i++) {
      this.removeSheet(sheets[i]);
    }
  };
  sheetengine.DensityMap.prototype.getTargetHeight = function(targetp, objectHeight) {
    var startz = targetp.z+objectHeight;
    for (var z=startz;z>0;z--) {
      var obstacle = this.get({x:targetp.x,y:targetp.y,z:z});
      if (obstacle)
        return z;
    }
    return 0;
  };
  sheetengine.DensityMap.prototype.getTargetPoint = function(targetPos, vector, objHeight, tolerance) {
    var allowMove = true;
    var stopFall = false;
    var targetp = {
      x:targetPos.x + vector.x, 
      y:targetPos.y + vector.y, 
      z:targetPos.z + vector.z};
    var h = this.getTargetHeight({x:targetp.x, y:targetp.y, z:targetp.z}, objHeight);
    if (h >= targetp.z) {
      if (h - targetp.z < tolerance) {
        stopFall = true;
        targetp.z = h;  // move allowed, but directed
      } else {
        // move not allowed, restrict movement
        // check in case user stays in place is it allowed to jump or fall down
        vector.x = 0;
        vector.y = 0;
        targetp = {
          x:targetPos.x, 
          y:targetPos.y, 
          z:targetPos.z + vector.z};
        var h = this.getTargetHeight({x:targetp.x, y:targetp.y, z:targetp.z}, objHeight);
        if (h >= targetp.z) {
          stopFall = true;
          if (h - targetp.z < tolerance) {
            targetp.z = h;  // move allowed, but directed
          } else {
            // move not allowed
            allowMove = false;
            targetp.z = h;
          }
        }
      }
    }
    return {allowMove: allowMove, targetp: targetp, movex: vector.x, movey: vector.y, stopFall: stopFall};
  };

  
  // initialize shadow's base matrix inverse
  shadows.shadowBaseMatrixInverse = geometry.getBaseMatrixInverse(shadows.lightSourcep1, shadows.lightSourcep2, shadows.lightSource);
  
  return sheetengine;
})();


// set exports for node.js
if (typeof(exports) !== 'undefined' && exports !== null) {
  exports = module.exports = sheetengine;
}
