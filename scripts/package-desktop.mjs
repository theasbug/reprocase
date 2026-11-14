import {packager} from '@electron/packager';
import {existsSync,readFileSync,writeFileSync,mkdtempSync,mkdirSync} from 'node:fs';
import {spawnSync} from 'node:child_process';
import {tmpdir} from 'node:os';
import {resolve,join,dirname,basename,relative,sep} from 'node:path';
const root=process.cwd(),pkg=JSON.parse(readFileSync('package.json','utf8'));
// Package for the current machine unless told otherwise (CI builds each platform on its own runner).
const platform=process.env.REPROCASE_PACKAGE_PLATFORM??process.platform, arch=process.env.REPROCASE_PACKAGE_ARCH??process.arch;
if(!['win32','darwin','linux'].includes(platform))throw new Error(`Unsupported desktop platform: ${platform}`);
process.env.PLAYWRIGHT_BROWSERS_PATH??=resolve('.browsers');
const {chromium}=await import('playwright');
const expected=chromium.executablePath();
// The bundled browser is the chromium-NNNN folder; the executable path inside it differs per platform
// (chrome-win64/chrome.exe, chrome-linux64/chrome, chrome-mac*/Chromium.app/Contents/MacOS/Chromium).
const configured=process.env.REPROCASE_PACKAGE_CHROMIUM;
let browser=configured?resolve(configured):expected;
while(!/^chromium-\d+$/.test(basename(browser))&&dirname(browser)!==browser)browser=dirname(browser);
const executable=relative(browser,configured?join(browser,process.env.REPROCASE_PACKAGE_CHROMIUM_EXECUTABLE??(platform==='win32'?'chrome-win64/chrome.exe':'')):expected).split(sep).join('/');
if(!/^chromium-\d+$/.test(basename(browser))||!executable||executable.startsWith('..')||!existsSync(join(browser,executable)))throw new Error('Run npm run browsers:install, or set REPROCASE_PACKAGE_CHROMIUM to a chromium-NNNN folder and REPROCASE_PACKAGE_CHROMIUM_EXECUTABLE to the executable inside it.');
const out=process.env.REPROCASE_PACKAGE_OUT?resolve(process.env.REPROCASE_PACKAGE_OUT):resolve(root,'../desktop-release-'+pkg.version);
if(existsSync(join(out,`ReproCase-${platform}-${arch}`)))throw new Error('Output already exists. Select a NEW REPROCASE_PACKAGE_OUT directory; existing user data is never overwritten.');
writeFileSync('desktop/browser-manifest.json',JSON.stringify({resourceDir:basename(browser),executable},null,2));
let icon=resolve('desktop/assets',platform==='win32'?'reprocase.ico':'reprocase.png');
if(platform==='darwin'){
  // Build the .icns from the PNG with macOS's own tools (sips + iconutil), so no binary icon is committed.
  const work=mkdtempSync(join(tmpdir(),'reprocase-icon-')),set=join(work,'reprocase.iconset');mkdirSync(set);
  for(const size of [16,32,128,256,512])for(const scale of [1,2]){
    const px=size*scale,name=`icon_${size}x${size}${scale===2?'@2x':''}.png`;
    const r=spawnSync('sips',['-z',String(px),String(px),resolve('desktop/assets/reprocase.png'),'--out',join(set,name)],{stdio:'ignore'});
    if(r.status!==0)throw new Error('sips failed while building the macOS icon');
  }
  const r=spawnSync('iconutil',['-c','icns',set,'-o',join(work,'reprocase.icns')],{stdio:'inherit'});
  if(r.status!==0)throw new Error('iconutil failed while building the macOS icon');
  icon=join(work,'reprocase.icns');
}
const paths=await packager({dir:root,out,name:'ReproCase',appVersion:pkg.version,platform,arch,electronVersion:pkg.devDependencies.electron,download:{cacheRoot:resolve(process.env.REPROCASE_ELECTRON_CACHE??join(root,'.cache','electron-packager'))},asar:false,prune:true,overwrite:false,icon,extraResource:[browser],ignore:[/^\/(ReproCase-data|\.cache|\.reprocase|\.browsers|\.git|\.github|work|test-results(?:-desktop)?|playwright-report|benchmark-results|tests|release)(\/|$)/,/^\/desktop\/src(\/|$)/,/\.env(?:\.|$)/],appBundleId:'io.github.theasbug.reprocase',appCategoryType:'public.app-category.developer-tools',win32metadata:{CompanyName:'ReproCase contributors',FileDescription:'ReproCase bug bounty workbench (beta)',ProductName:'ReproCase'}});
console.log(JSON.stringify({packaged:paths,browser:basename(browser)}));
