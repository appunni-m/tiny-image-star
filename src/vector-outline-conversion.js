import { validateVectorOutlineResult, VectorGeometryError, VECTOR_GEOMETRY_LIMITS } from './vector-geometry-contract.js';

const fail = message => { throw new VectorGeometryError(message,'VECTOR_GEOMETRY_CONVERSION'); };
const samePoint=(a,b)=>a.x===b.x&&a.y===b.y;
const half=(a,b)=>({x:(a.x+b.x)/2,y:(a.y+b.y)/2,w:(a.w+b.w)/2});
const projected=value=>({x:value.x/value.w,y:value.y/value.w});
const choose2=[1,2,1];const choose4=[1,4,6,4,1];

function approximateConic(homogeneous,depth,emit){
  const [a,b,c]=homogeneous;const start=projected(a);const end=projected(c);
  const middle=projected(half(half(a,b),half(b,c)));
  const control={x:2*middle.x-(start.x+end.x)/2,y:2*middle.y-(start.y+end.y)/2};
  const polynomial=[start,control,end];
  // N-D*Q is a degree4 Bernstein polynomial. Its control hull bounds the
  // numerator's norm, and positive rational weights bound D from below.
  // This provides an all-parameter error bound rather than sample agreement.
  let numeratorBound=0;
  for(let k=0;k<=4;k++){
    let x=0;let y=0;
    for(let i=0;i<3;i++){
      const j=k-i;if(j<0||j>2)continue;
      const factor=choose2[i]*choose2[j]/choose4[k];
      x+=(homogeneous[i].x-homogeneous[i].w*polynomial[j].x)*factor;
      y+=(homogeneous[i].y-homogeneous[i].w*polynomial[j].y)*factor;
    }
    numeratorBound=Math.max(numeratorBound,Math.hypot(x,y));
  }
  const scale=Math.max(1,...polynomial.flatMap(point=>[Math.abs(point.x),Math.abs(point.y)]));
  const bound=numeratorBound/Math.min(a.w,b.w,c.w)+Number.EPSILON*scale*64;
  if(bound<=VECTOR_GEOMETRY_LIMITS.conicTolerance){emit(start,control,end);return;}
  if(depth>=VECTOR_GEOMETRY_LIMITS.maxConicDepth)fail('The rational curve cannot be converted within the bounded local error tolerance.');
  const ab=half(a,b);const bc=half(b,c);const mid=half(ab,bc);
  approximateConic([a,ab,mid],depth+1,emit);approximateConic([mid,bc,c],depth+1,emit);
}

/**
 * Convert a native outline into editable cubic contours in its original box.
 * Quadratic conversion is exact. Rational conics are subdivided until the
 * proven error from the native Float32 path is at most0.01 local pixels.
 * This bound does not describe Skia's own numerical stroke-offset precision.
 */
export function outlinedGeometryToPathGeometry(result,width,height){
  validateVectorOutlineResult(result);
  if(!Number.isFinite(width)||!Number.isFinite(height)||width<0||height<0)fail('The outlined path needs finite nonnegative dimensions.');
  const safeWidth=width>0?width:1;const safeHeight=height>0?height:1;
  const contours=[];let current=null;let position=null;let pointCount=0;
  const normalize=point=>({x:point.x/safeWidth,y:point.y/safeHeight,in:{x:0,y:0},out:{x:0,y:0}});
  const addPoint=point=>{
    if(++pointCount>VECTOR_GEOMETRY_LIMITS.maxOutputPoints)fail('The converted vector exceeds its bounded editable point limit.');
    const value=normalize(point);current.points.push(value);return value;
  };
  const cubic=(start,c1,c2,end)=>{
    const previous=current.points.at(-1);
    previous.out={x:(c1.x-start.x)/safeWidth,y:(c1.y-start.y)/safeHeight};
    const finish=addPoint(end);finish.in={x:(c2.x-end.x)/safeWidth,y:(c2.y-end.y)/safeHeight};position=end;
  };
  const quadratic=(start,control,end)=>cubic(start,
    {x:start.x+2*(control.x-start.x)/3,y:start.y+2*(control.y-start.y)/3},
    {x:end.x+2*(control.x-end.x)/3,y:end.y+2*(control.y-end.y)/3},end);
  const finishContour=()=>{
    if(!current)return;
    if(!current.closed)fail('The stroke outline contains an unexpectedly open filled contour.');
    if(current.points.length>1&&samePoint(current.points[0],current.points.at(-1))){
      const duplicate=current.points.pop();current.points[0].in=duplicate.in;
    }
    if(current.points.length)contours.push(current);current=null;
  };
  const commands=result.commands;let cursor=0;
  while(cursor<commands.length){
    const verb=commands[cursor++];
    if(verb===0){finishContour();position={x:commands[cursor++],y:commands[cursor++]};current={closed:false,points:[]};addPoint(position);}
    else if(verb===1){position={x:commands[cursor++],y:commands[cursor++]};addPoint(position);}
    else if(verb===2){const control={x:commands[cursor++],y:commands[cursor++]};const end={x:commands[cursor++],y:commands[cursor++]};quadratic(position,control,end);}
    else if(verb===3){
      const control={x:commands[cursor++],y:commands[cursor++]};const end={x:commands[cursor++],y:commands[cursor++]};const weight=commands[cursor++];
      approximateConic([{...position,w:1},{x:control.x*weight,y:control.y*weight,w:weight},{...end,w:1}],0,quadratic);
    }else if(verb===4){const c1={x:commands[cursor++],y:commands[cursor++]};const c2={x:commands[cursor++],y:commands[cursor++]};const end={x:commands[cursor++],y:commands[cursor++]};cubic(position,c1,c2,end);}
    else if(verb===5){current.closed=true;finishContour();position=null;}
  }
  finishContour();
  const first=contours.shift();return{closed:true,points:first?.points||[],...(contours.length?{subpaths:contours}:{}),fillRule:result.fillRule};
}
