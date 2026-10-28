import {mkdir,copyFile,rm,readFile,writeFile} from 'node:fs/promises';
import {execFileSync} from 'node:child_process';
import {resolve} from 'node:path';
const original=resolve('public/branding/leaf-logo-rounded.png');
if(process.platform==='darwin') {
  await mkdir('.cache/swift',{recursive:true});
  execFileSync('xcrun',['swift','-module-cache-path','.cache/swift','scripts/render-icon.swift',resolve('public/branding/leaf-logo-rounded-source.png'),original],{stdio:'inherit'});
}
await mkdir('apps/macos/Resources',{recursive:true});
await copyFile(original,'apps/macos/Resources/LeafLogo.png');
const harmony='apps/harmony/AppScope/resources/base/media/app_icon.png';
// Harmony keeps its own full-size face, without macOS Dock padding.
// Rounded alpha silhouette is baked into platform PNG/ICNS resources, not only a UI clip.
if(process.platform==='darwin') {
  const iconset=resolve('build/branding/LeafReader.iconset');
  await mkdir(iconset,{recursive:true});
  for(const size of [16,32,128,256,512]) {
    for(const scale of [1,2]) {
      const output=`${iconset}/icon_${size}x${size}${scale===2?'@2x':''}.png`;
      execFileSync('/usr/bin/sips',['-z',String(size*scale),String(size*scale),original,'--out',output],{stdio:'ignore'});
    }
  }
  // Modern ICNS is a length-prefixed container of PNG representations.
  const representations=[['icp4','icon_16x16.png'],['icp5','icon_32x32.png'],['icp6','icon_32x32@2x.png'],
    ['ic07','icon_128x128.png'],['ic08','icon_256x256.png'],['ic09','icon_512x512.png'],['ic10','icon_512x512@2x.png'],
    ['ic11','icon_16x16@2x.png'],['ic12','icon_32x32@2x.png'],['ic13','icon_128x128@2x.png'],['ic14','icon_256x256@2x.png']];
  const chunks=[];
  for(const [type,file] of representations){
    const png=await readFile(`${iconset}/${file}`); const chunk=Buffer.alloc(8+png.length);
    chunk.write(type,0,4,'ascii'); chunk.writeUInt32BE(chunk.length,4); png.copy(chunk,8); chunks.push(chunk);
  }
  const header=Buffer.alloc(8);header.write('icns',0,4,'ascii');header.writeUInt32BE(8+chunks.reduce((sum,c)=>sum+c.length,0),4);
  await writeFile('apps/macos/Resources/LeafReader.icns',Buffer.concat([header,...chunks]));
  execFileSync('xcrun',['swift','-module-cache-path','.cache/swift','scripts/render-icon.swift',original,resolve(harmony),'harmony'],{stdio:'inherit'});
  await mkdir('apps/windows/Resources',{recursive:true});
  const sizes=[16,32,48,64,128,256];const images=[];
  for(const size of sizes){
    const path=`${iconset}/windows_${size}.png`;
    execFileSync('/usr/bin/sips',['-z',String(size),String(size),harmony,'--out',path],{stdio:'ignore'});
    images.push(await readFile(path));
  }
  const icoHeader=Buffer.alloc(6+16*sizes.length);icoHeader.writeUInt16LE(1,2);icoHeader.writeUInt16LE(sizes.length,4);
  let position=icoHeader.length;
  for(let index=0;index<sizes.length;index++){
    const entry=6+16*index;icoHeader[entry]=sizes[index]===256?0:sizes[index];icoHeader[entry+1]=icoHeader[entry];
    icoHeader.writeUInt16LE(1,entry+4);icoHeader.writeUInt16LE(32,entry+6);icoHeader.writeUInt32LE(images[index].length,entry+8);icoHeader.writeUInt32LE(position,entry+12);position+=images[index].length;
  }
  await writeFile('apps/windows/Resources/LeafReader.ico',Buffer.concat([icoHeader,...images]));

}
await rm('apps/harmony/AppScope/resources/base/media/app_icon.svg',{force:true});
console.log('应用标志与平台图标已准备完成。');
