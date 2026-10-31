const assert=require('node:assert/strict'),fs=require('node:fs'),ts=require('typescript'),vm=require('node:vm')
const m={exports:{}};vm.runInNewContext(ts.transpileModule(fs.readFileSync('src/lib/power-contract-table.ts','utf8'),{compilerOptions:{module:1,target:9}}).outputText,{module:m,exports:m.exports,Uint8Array,Math});const detect=m.exports.powerTableRows
function fixture(horizontal=true,vertical=true){const width=600,height=850,data=new Uint8ClampedArray(width*height*4).fill(255),dot=(x,y)=>{const n=(y*width+x)*4;data[n]=data[n+1]=data[n+2]=0};if(horizontal)for(let y=200;y<=700;y+=50)for(let x=50;x<=550;x++)dot(x,y);if(vertical)for(const x of [50,150,550])for(let y=200;y<=700;y++)dot(x,y);if(vertical)for(const x of [300,400])for(let y=400;y<=600;y++)dot(x,y);return{width,height,data}}
const rows=detect(fixture(),1);assert.equal(rows.length,10);assert.equal(rows[0].cells.length,2);assert.equal(rows[4].cells.length,4);assert.equal(rows[0].cells[0].left,52);assert.equal(rows[0].cells[0].width,96)
for(const row of rows)for(const c of row.cells){assert.ok(c.width>0&&c.height>0&&c.left>=0&&c.top>=0&&c.left+c.width<=600&&c.top+c.height<=850)}
assert.equal(detect(fixture(false),1).length,0);assert.equal(detect(fixture(true,false),1).length,0);assert.equal(detect({width:3000,height:3000,data:new Uint8ClampedArray()},1).length,0)
assert.equal(detect({width:600,height:850,data:new Uint8ClampedArray(1)},1).length,0)
console.log('PASS: actual ruled-cell boundaries, merged and four-column cells, no coordinates guessed from missing grid, bounded image size')
