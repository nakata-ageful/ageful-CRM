export type PowerCell={left:number;top:number;width:number;height:number}
export type PowerTableRow={cells:PowerCell[]}

/** Find actual ruled cells, without a company-specific page template. Pixels
 * are inspected only after a scanned PDF is selected; the source is unchanged.
 * A missing/broken/complex grid yields no cells, rather than guessed positions. */
export function powerTableRows(image:{width:number;height:number;data:Uint8ClampedArray},scale:number):PowerTableRow[]{
 const {width:w,height:h,data}=image
 if(w*h>5000000||w<100||h<100||data.length!==w*h*4)return []
 const dark=new Uint8Array(w*h),horizontal:number[]=[],vertical:number[]=[]
 for(let y=0;y<h;y++){let run=0,max=0;for(let x=0;x<w;x++){const i=y*w+x,j=i*4;dark[i]=data[j+3]>128&&Math.min(data[j],data[j+1],data[j+2])<140?1:0;run=dark[i]?run+1:0;max=Math.max(max,run)}if(max>w*.35)horizontal.push(y)}
 for(let x=0;x<w;x++){let run=0,max=0;for(let y=0;y<h;y++){run=dark[y*w+x]?run+1:0;max=Math.max(max,run)}if(max>Math.max(h*.08,30*scale))vertical.push(x)}
 const bands=(values:number[])=>{const a:{start:number;end:number}[]=[];for(const v of values){const last=a.at(-1);if(last&&v<=last.end+2)last.end=v;else a.push({start:v,end:v})}return a}
 const ys=bands(horizontal),xs=bands(vertical)
 if(ys.length<7||ys.length>25||xs.length<3||xs.length>8)return []
 const rows:PowerTableRow[]=[]
 for(let i=0;i<ys.length-1;i++){
  const top=ys[i].end+1,bottom=ys[i+1].start,gap=Math.max(2,Math.ceil(2*scale))
  if(bottom-top<14*scale||bottom-top>70*scale)continue
  const borders=xs.filter(b=>{let hits=0;const x=Math.round((b.start+b.end)/2);for(let y=top+gap;y<bottom-gap;y++)hits+=dark[y*w+x];return hits>(bottom-top-2*gap)*.65})
  if(borders.length!==3&&borders.length!==5)continue
  const cells=borders.slice(0,-1).map((b,j)=>({left:b.end+gap,top:top+gap,width:borders[j+1].start-b.end-2*gap,height:bottom-top-2*gap}))
  if(cells.every(c=>c.width>35*scale&&c.height>8*scale))rows.push({cells})
 }
 if(rows.length<6||rows.some(r=>Math.abs(r.cells[0].left-rows[0].cells[0].left)>5*scale||Math.abs(r.cells[0].width-rows[0].cells[0].width)>5*scale))return []
 return rows
}
