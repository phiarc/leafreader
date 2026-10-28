import { exportPublicSource } from './export-public-source.mjs';
import { cp, mkdir, readFile, writeFile, readdir, stat, rm } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { resolve, basename, relative } from 'node:path';
const output=resolve('build/releases');await mkdir(output,{recursive:true});
const macApp=resolve('build/macos/页间.app');
if(await stat(macApp).then(info=>info.isDirectory()).catch(()=>false)) execFileSync('/usr/bin/ditto',['-c','-k','--keepParent',macApp,`${output}/页间-macOS-AppleSilicon.zip`]);
else console.log('本轮仅更新鸿蒙与工程包，保留已有 macOS 发布文件。');
await cp('apps/harmony/entry/build/default/outputs/default/entry-default-unsigned.hap',`${output}/页间-HarmonyOS-unsigned.hap`);
const staging=await exportPublicSource(`${output}/source/leaf-reader`);
execFileSync('/usr/bin/ditto',['-c','-k','--keepParent',staging,`${output}/页间-完整工程.zip`]);
const harmonyVersion=JSON.parse(await readFile('apps/harmony/AppScope/app.json5','utf8')).app.versionName;
const note=`页间测试版（macOS 0.1.12 / 鸿蒙 0.1.13）\n\nmacOS：解压后替换旧版并退出重开 页间.app，使用透明圆角 Dock 图标，支持持久连接和书本同步；阅读偏好可拖动或输入每侧 0–35% 的文字留白。\n鸿蒙：版本 ${harmonyVersion}，应用及启动窗口图标去掉 macOS 外圈透明留白，保留圆角，恢复正常图标占位；阅读布局不变。提供通用未签名 HAP；请用完整工程配置自己的调试签名。设备专用签名包仅适用于签名关联设备。本次未安装或调试鸿蒙设备。\n\n两端连接同一个阅读空间后，导入的 TXT/PDF 自动上传，另一端出现书目，点击下载接着读。已下载书籍支持离线阅读。书卡管理中，“移除下载”保留书目和进度；“从书库删除”同步删除云端文件和书目。5 GiB 逻辑容量上限，TXT 30 MiB / PDF 100 MiB，书签仍只在本机。\nAzure 真实 TXT/PDF 上传、下载校验和删除已验证。个人配置不包含在发布包中，开发项目配置位于 .cache/leaf-sync-connection.json。\n\n具体限制与验证说明见 README.md 和 docs/BOOK_SYNC_0.1.9.md 和 docs/LAYOUT_0.1.10.md。\n`;
await writeFile(`${output}/使用说明.txt`,note);
const files=[];for(const name of await readdir(output)){const path=`${output}/${name}`;const info=await stat(path);if(info.isFile())files.push({name,bytes:info.size});}
console.log(JSON.stringify(files,null,2));
