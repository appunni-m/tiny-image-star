import { rectangleStrokeSideJoins, rectangleStrokeSidePaths } from './stroke-side-geometry.js';
import { isUniformStrokeSideWidths, strokeSideWidths } from './strokes.js';
import { strokeDashArray } from './stroke-style.js';
import { normalizeVectorBooleanRequest, normalizeVectorOutlineRequest, validateVectorOutlineResult, VectorGeometryError, VECTOR_GEOMETRY_LIMITS } from './vector-geometry-contract.js';

function arcSweep(command) {
  const tau = Math.PI * 2; const raw = command.endAngle - command.startAngle;
  if (!command.anticlockwise && raw >= tau) return tau;
  if (command.anticlockwise && raw <= -tau) return -tau;
  let sweep = raw % tau;
  if (command.anticlockwise && sweep > 0) sweep -= tau;
  else if (!command.anticlockwise && sweep < 0) sweep += tau;
  return sweep;
}

/** Native rational arcs enter Skia directly, without cubic arc approximation. */
function appendEllipse(builder, command) {
  const rx = command.type === 'arc' ? command.radius : command.radiusX;
  const ry = command.type === 'arc' ? command.radius : command.radiusY;
  const rotation = command.rotation || 0; const sweep = arcSweep(command);
  const segments = Math.ceil(Math.abs(sweep) / (Math.PI / 2));
  const transform = (x,y) => ({ x: command.center.x + x * Math.cos(rotation) - y * Math.sin(rotation),
    y: command.center.y + x * Math.sin(rotation) + y * Math.cos(rotation) });
  for (let index = 0; index < segments; index++) {
    const start = command.startAngle + sweep * index / segments;
    const end = command.startAngle + sweep * (index + 1) / segments;
    const middle = (start + end) / 2; const weight = Math.cos((end - start) / 2);
    const control = transform(rx * Math.cos(middle) / weight, ry * Math.sin(middle) / weight);
    const finish = transform(rx * Math.cos(end), ry * Math.sin(end));
    builder.conicTo(control.x,control.y,finish.x,finish.y,weight);
  }
}

/** Shared native allocation scope for one job, including all recursive regions. */
function geometryScope(kit, execute) {
  const owned = new Set();
  let strokeWorkPoints = 0;
  const own = value => {
    if (!value) throw new VectorGeometryError('Skia could not produce a safe vector outline.');
    owned.add(value); return value;
  };
  const release = value => { if (owned.delete(value)) value.delete(); };
  const checkHeap = () => { if (kit.HEAPU8.byteLength > VECTOR_GEOMETRY_LIMITS.maxHeapBytes) throw new VectorGeometryError('The vector operation exceeded its memory budget.','VECTOR_GEOMETRY_LIMIT'); };
  const combine = (a,b,operation) => {
    const result=own(kit.Path.MakeFromOp(a,b,operation));checkHeap();
    if (result.countPoints() > VECTOR_GEOMETRY_LIMITS.maxOutputPoints) throw new VectorGeometryError('The outlined vector exceeds its bounded output point limit.','VECTOR_GEOMETRY_LIMIT');
    return result;
  };
  const path = (contours,fillRule='nonzero') => {
    const builder=own(new kit.PathBuilder());
    builder.setFillType(fillRule==='evenodd'?kit.FillType.EvenOdd:kit.FillType.Winding);
    for(const contour of contours){
      builder.moveTo(contour.start.x,contour.start.y);
      for(const command of contour.commands){
        if(command.type==='line')builder.lineTo(command.end.x,command.end.y);
        else if(command.type==='quadratic')builder.quadTo(command.control.x,command.control.y,command.end.x,command.end.y);
        else if(command.type==='cubic')builder.cubicTo(command.control1.x,command.control1.y,command.control2.x,command.control2.y,command.end.x,command.end.y);
        else appendEllipse(builder,command);
      }
      if(contour.closed)builder.close();
    }
    const result=own(builder.detach());release(builder);return result;
  };
  const caps={butt:kit.StrokeCap.Butt,round:kit.StrokeCap.Round,square:kit.StrokeCap.Square};
  const joins={miter:kit.StrokeJoin.Miter,round:kit.StrokeJoin.Round,bevel:kit.StrokeJoin.Bevel};
  const strokePath = (source,stroke,width,cap=stroke.cap,dashWidth=width) => {
    if (!(width>0) || source.isEmpty()) return own(new kit.Path());
    if ((strokeWorkPoints += source.countPoints()) > VECTOR_GEOMETRY_LIMITS.maxStrokeWorkPoints) throw new VectorGeometryError('The vector operation exceeds its bounded source-stroke work limit.','VECTOR_GEOMETRY_LIMIT');
    let centerline=source;
    const dashes=strokeDashArray({...stroke,width:dashWidth});
    if(dashes.length)centerline=own(source.makeDashed(dashes[0],dashes[1],0));
    const result=own(centerline.makeStroked({width,cap:caps[stroke.pattern==='dotted'?'round':cap],join:joins[stroke.join],miter_limit:stroke.miterLimit,precision:4}));
    if(centerline!==source)release(centerline);checkHeap();return result;
  };
  const pointsContour=points=>({start:points[0],commands:points.slice(1).map((end,index)=>({type:'line',start:points[index],end})),closed:false});
  const fillGeometry = (geometry,indices) => {
    let fill=own(new kit.Path());
    for(const group of indices?indices.map(index=>geometry.fillGroups[index]):geometry.fillGroups){
      const source=path(group.contours,group.fillRule);const next=combine(fill,source,kit.PathOp.Union);
      release(fill);release(source);fill=next;
    }
    return fill;
  };
  const outlineGeometry = (geometry,stroke) => {
    const aligned=stroke.alignment!=='center';const multiplier=aligned?2:1;
    let result=own(new kit.Path());const sides=geometry.rectangleSideGeometry?strokeSideWidths(stroke):null;
    if(sides && !isUniformStrokeSideWidths(sides)){
      const rectangle=geometry.rectangleSideGeometry;
      const runs=rectangleStrokeSidePaths(rectangle.width,rectangle.height,rectangle.radii,rectangle.smoothing);
      for(const run of runs){
        if(!(sides[run.side]>0))continue;
        const source=path([pointsContour(run.points)]);const outlined=strokePath(source,stroke,sides[run.side]*multiplier,'butt',sides[run.side]);
        const next=combine(result,outlined,kit.PathOp.Union);release(result);release(source);release(outlined);result=next;
      }
      if(stroke.pattern==='solid'){
        const widths=Object.fromEntries(Object.entries(sides).map(([side,width])=>[side,width*multiplier]));
        for(const patch of rectangleStrokeSideJoins(runs,widths,stroke.join,stroke.miterLimit)){
          const contour=pointsContour(patch.points);contour.closed=true;const source=path([contour]);
          const next=combine(result,source,kit.PathOp.Union);release(result);release(source);result=next;
        }
      }
    } else {
      const source=path(aligned?geometry.alignedStrokeContours:geometry.strokeContours,geometry.fillRule);
      const width=(sides?sides.top:stroke.width)*multiplier;
      release(result);result=strokePath(source,stroke,width,stroke.cap,sides?sides.top:stroke.width);release(source);
    }
    if(aligned){
      const fill=fillGeometry(geometry);
      const clipped=combine(result,fill,stroke.alignment==='inside'?kit.PathOp.Intersect:kit.PathOp.Difference);
      release(result);release(fill);result=clipped;
    }
    return result;
  };
  const outlineRegion = (source,stroke) => {
    const aligned=stroke.alignment!=='center';
    const result=strokePath(source,stroke,stroke.width*(aligned?2:1),stroke.cap,stroke.width);
    if(!aligned)return result;
    const clipped=combine(result,source,stroke.alignment==='inside'?kit.PathOp.Intersect:kit.PathOp.Difference);
    release(result);return clipped;
  };
  const transformPath = (source,matrix) => {
    if(matrix.every((value,index)=>value===[1,0,0,1,0,0][index]))return source;
    const [a,b,c,d,e,f]=matrix;const builder=own(new kit.PathBuilder(source));
    builder.transform([a,c,e,b,d,f,0,0,1]);
    const result=own(builder.detach());release(builder);release(source);checkHeap();return result;
  };
  try {
    const result=execute({own,release,combine,path,fillGeometry,outlineGeometry,outlineRegion,transformPath});
    if(result.countPoints()>VECTOR_GEOMETRY_LIMITS.maxOutputPoints)throw new VectorGeometryError('The outlined vector exceeds its bounded output point limit.','VECTOR_GEOMETRY_LIMIT');
    const nativeBounds=result.computeTightBounds();const commands=result.toCmds().slice();
    checkHeap();return validateVectorOutlineResult({commands,fillRule:result.getFillType()===kit.FillType.EvenOdd?'evenodd':'nonzero',bounds:{left:nativeBounds[0],top:nativeBounds[1],right:nativeBounds[2],bottom:nativeBounds[3]}});
  } finally { for(const value of owned)value.delete(); }
}

/** Execute one bounded stroke-outline job without changing its public semantics. */
export function outlineStrokeGeometryWithKit(kit, geometry, sourceStroke) {
  const request = normalizeVectorOutlineRequest(geometry,sourceStroke);
  return geometryScope(kit,scope=>scope.outlineGeometry(request.geometry,request.stroke));
}

/** Ordered Boolean operations on exact native fill and stroke regions. */
export function booleanGeometryWithKit(kit, request) {
  const { root }=normalizeVectorBooleanRequest(request);
  return geometryScope(kit,scope=>{
    const {own,release,combine,fillGeometry,outlineGeometry,outlineRegion,transformPath}=scope;
    const operations={union:kit.PathOp.Union,subtract:kit.PathOp.Difference,intersect:kit.PathOp.Intersect,exclude:kit.PathOp.XOR};
    const visit=node=>{
      let base;
      if(node.kind==='shape')base=node.includeFill?fillGeometry(node.geometry,node.fillGroupIndices):own(new kit.Path());
      else{
        base=node.children.length?visit(node.children[0]):own(new kit.Path());
        for(const child of node.children.slice(1)){
          const operand=visit(child);const next=combine(base,operand,operations[node.operation]);
          release(base);release(operand);base=next;
        }
      }
      let result=node.kind==='boolean'&&!node.includeFill?own(new kit.Path()):base;
      for(const stroke of node.strokes){
        const outlined=node.kind==='shape'?outlineGeometry(node.geometry,stroke):outlineRegion(base,stroke);
        const next=combine(result,outlined,kit.PathOp.Union);
        if(result!==base)release(result);release(outlined);result=next;
      }
      if(result!==base)release(base);
      return transformPath(result,node.transform);
    };
    return visit(root);
  });
}
