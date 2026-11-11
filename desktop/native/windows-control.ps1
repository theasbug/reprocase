param([Parameter(Mandatory=$true)][string]$Payload)
$ErrorActionPreference='Stop'
[Console]::OutputEncoding=New-Object Text.UTF8Encoding($false)
$data=[Text.Encoding]::UTF8.GetString([Convert]::FromBase64String($Payload))|ConvertFrom-Json
Add-Type -TypeDefinition @'
using System;using System.Text;using System.Collections.Generic;using System.Runtime.InteropServices;
public static class RCDesktop {
 [StructLayout(LayoutKind.Sequential)] public struct RECT {public int Left,Top,Right,Bottom;}
 [StructLayout(LayoutKind.Sequential)] public struct POINT {public int X,Y;}
 [StructLayout(LayoutKind.Sequential)] public struct MOUSEINPUT {public int dx,dy;public uint mouseData,dwFlags,time;public UIntPtr dwExtraInfo;}
 [StructLayout(LayoutKind.Sequential)] public struct KEYBDINPUT {public ushort wVk,wScan;public uint dwFlags,time;public UIntPtr dwExtraInfo;}
 [StructLayout(LayoutKind.Explicit)] public struct UNION {[FieldOffset(0)]public MOUSEINPUT mi;[FieldOffset(0)]public KEYBDINPUT ki;}
 [StructLayout(LayoutKind.Sequential)] public struct INPUT {public uint type;public UNION U;}
 public class Window {public string id,title;public int pid;public RECT bounds;}
 public delegate bool EnumProc(IntPtr h,IntPtr p);
 [DllImport("user32.dll")]public static extern bool EnumWindows(EnumProc p,IntPtr l);
 [DllImport("user32.dll")]public static extern bool IsWindowVisible(IntPtr h);
 [DllImport("user32.dll")]public static extern bool IsWindow(IntPtr h);
 [DllImport("user32.dll")]public static extern bool IsIconic(IntPtr h);
 [DllImport("user32.dll",CharSet=CharSet.Unicode)]static extern int GetWindowText(IntPtr h,StringBuilder s,int n);
 [DllImport("user32.dll")]static extern uint GetWindowThreadProcessId(IntPtr h,out int p);
 [DllImport("kernel32.dll")]static extern uint GetCurrentThreadId();
 [DllImport("user32.dll")]static extern bool AttachThreadInput(uint a,uint b,bool attach);
 [DllImport("user32.dll")]static extern bool BringWindowToTop(IntPtr h);
 [DllImport("user32.dll")]public static extern bool GetWindowRect(IntPtr h,out RECT r);
 [DllImport("dwmapi.dll")]static extern int DwmGetWindowAttribute(IntPtr h,int a,out RECT r,int s);
 [DllImport("user32.dll")]public static extern bool SetForegroundWindow(IntPtr h);
 [DllImport("user32.dll")]public static extern IntPtr GetForegroundWindow();
 [DllImport("user32.dll")]public static extern bool ShowWindow(IntPtr h,int n);
 [DllImport("user32.dll")]public static extern bool MoveWindow(IntPtr h,int x,int y,int w,int z,bool repaint);
 [DllImport("user32.dll")]static extern bool SetCursorPos(int x,int y);
 [DllImport("user32.dll")]static extern uint SendInput(uint n,INPUT[] i,int size);
 [DllImport("user32.dll")]public static extern IntPtr SetThreadDpiAwarenessContext(IntPtr c);
 public static RECT Bounds(IntPtr h){RECT r;if(DwmGetWindowAttribute(h,9,out r,16)!=0)GetWindowRect(h,out r);return r;}
 public static bool Focus(IntPtr h){if(IsIconic(h))ShowWindow(h,9);if(GetForegroundWindow()==h)return true;uint current=GetCurrentThreadId();int p;uint foreground=GetWindowThreadProcessId(GetForegroundWindow(),out p),target=GetWindowThreadProcessId(h,out p);bool a=false,b=false;try{if(current!=foreground&&foreground!=0)a=AttachThreadInput(current,foreground,true);if(current!=target&&target!=foreground)b=AttachThreadInput(current,target,true);BringWindowToTop(h);SetForegroundWindow(h);System.Threading.Thread.Sleep(100);return GetForegroundWindow()==h;}finally{if(b)AttachThreadInput(current,target,false);if(a)AttachThreadInput(current,foreground,false);}}
 public static Window[] Windows(){var result=new List<Window>();EnumWindows((h,l)=>{if(IsWindowVisible(h)){var title=new StringBuilder(1024);GetWindowText(h,title,1024);if(title.Length>0){int pid;GetWindowThreadProcessId(h,out pid);result.Add(new Window{id=h.ToInt64().ToString(),title=title.ToString(),pid=pid,bounds=Bounds(h)});}}return true;},IntPtr.Zero);return result.ToArray();}
 static void Input(INPUT input){if(SendInput(1,new[]{input},Marshal.SizeOf(typeof(INPUT)))!=1)throw new Exception("Windows rejected input. The target may have higher privileges or be on a secure desktop.");}
 static void Mouse(uint flags,int data=0){Input(new INPUT{type=0,U=new UNION{mi=new MOUSEINPUT{dwFlags=flags,mouseData=unchecked((uint)data)}}});}
 static void Key(ushort code,bool up=false,bool unicode=false){Input(new INPUT{type=1,U=new UNION{ki=new KEYBDINPUT{wVk=unicode?(ushort)0:code,wScan=unicode?code:(ushort)0,dwFlags=(uint)((up?2:0)|(unicode?4:0))}}});}
 public static void Type(IntPtr target,string text){foreach(char c in text){if(GetForegroundWindow()!=target)throw new Exception("Window focus changed; typing stopped.");Key(c,false,true);Key(c,true,true);}}
 static ushort Code(string value){switch(value.ToUpperInvariant()){case "CTRL":case "CONTROL":return 0x11;case "ALT":return 0x12;case "SHIFT":return 0x10;case "WIN":case "META":return 0x5B;case "ENTER":return 0x0D;case "TAB":return 9;case "ESC":case "ESCAPE":return 0x1B;case "BACKSPACE":return 8;case "DELETE":return 0x2E;case "SPACE":return 0x20;case "UP":return 0x26;case "DOWN":return 0x28;case "LEFT":return 0x25;case "RIGHT":return 0x27;case "HOME":return 0x24;case "END":return 0x23;case "PAGEUP":return 0x21;case "PAGEDOWN":return 0x22;}if(value.Length==1)return (ushort)Char.ToUpperInvariant(value[0]);int f;if(value.StartsWith("F")&&Int32.TryParse(value.Substring(1),out f)&&f>=1&&f<=24)return (ushort)(0x6F+f);throw new Exception("Unsupported key: "+value);}
 public static void Press(IntPtr target,string chord){var keys=chord.Split('+');var down=new List<ushort>();try{foreach(var part in keys){if(GetForegroundWindow()!=target)throw new Exception("Window focus changed; key input stopped.");var code=Code(part.Trim());Key(code);down.Add(code);}}finally{for(int i=down.Count-1;i>=0;i--)Key(down[i],true);}}
 public static void Release(string chord,bool drag){if(drag)Mouse(4);if(!String.IsNullOrEmpty(chord)){var keys=chord.Split('+');for(int i=keys.Length-1;i>=0;i--)Key(Code(keys[i].Trim()),true);}}
 public static void Move(int x,int y){if(!SetCursorPos(x,y))throw new Exception("Could not move the pointer");}
 public static void Click(int x,int y,string button,int count){Move(x,y);uint d=button=="right"?8u:button=="middle"?32u:2u;for(int i=0;i<count;i++){Mouse(d);Mouse(d*2);System.Threading.Thread.Sleep(70);}}
 public static void Scroll(int x,int y,int amount,bool horizontal){Move(x,y);Mouse(horizontal?0x1000u:0x800u,amount*120);}
 public static void Drag(int x,int y,int endX,int endY){Move(x,y);Mouse(2);try{for(int i=1;i<=20;i++){Move(x+(endX-x)*i/20,y+(endY-y)*i/20);System.Threading.Thread.Sleep(12);}}finally{Mouse(4);}}
}
'@
[void][RCDesktop]::SetThreadDpiAwarenessContext([IntPtr](-4))
$handle=[IntPtr]::Zero
if($data.windowId){$handle=[IntPtr]([long]$data.windowId);if(-not [RCDesktop]::IsWindow($handle)){throw 'The target window no longer exists. List windows again.'}}
switch($data.operation){
 'windows' { @{windows=@([RCDesktop]::Windows());foreground=[RCDesktop]::GetForegroundWindow().ToInt64().ToString()}|ConvertTo-Json -Depth 8 -Compress }
 'bounds' { [RCDesktop]::Bounds($handle)|ConvertTo-Json -Compress }
 'window' {
   switch($data.action){'focus'{if(-not [RCDesktop]::Focus($handle)){throw 'Windows did not grant foreground focus'}}'restore'{[void][RCDesktop]::ShowWindow($handle,9)}'minimize'{[void][RCDesktop]::ShowWindow($handle,6)}'maximize'{[void][RCDesktop]::ShowWindow($handle,3)}'move'{ $r=[RCDesktop]::Bounds($handle);[void][RCDesktop]::MoveWindow($handle,[int]$data.x,[int]$data.y,$r.Right-$r.Left,$r.Bottom-$r.Top,$true)}'resize'{ $r=[RCDesktop]::Bounds($handle);[void][RCDesktop]::MoveWindow($handle,$r.Left,$r.Top,[int]$data.width,[int]$data.height,$true)}default{throw 'Unknown window action'}}
   @{ok=$true;bounds=[RCDesktop]::Bounds($handle)}|ConvertTo-Json -Depth 5 -Compress
 }
 'mouse' {switch($data.action){'move'{[RCDesktop]::Move($data.x,$data.y)}'click'{[RCDesktop]::Click($data.x,$data.y,$data.button,$data.clicks)}'scroll'{[RCDesktop]::Scroll($data.x,$data.y,$data.amount,$data.horizontal)}'drag'{[RCDesktop]::Drag($data.x,$data.y,$data.endX,$data.endY)}default{throw 'Unknown mouse action'}};' {"ok":true}' }
 'keyboard' {if(-not [RCDesktop]::Focus($handle)){throw 'The intended window is not focused. Input was not sent.'};if($data.action -eq 'type'){[RCDesktop]::Type($handle,$data.text)}else{[RCDesktop]::Press($handle,$data.text)};' {"ok":true}' }
 'release' {[RCDesktop]::Release([string]$data.chord,[bool]$data.drag);' {"ok":true}'}
 'accessibility' {
   Add-Type -AssemblyName UIAutomationClient;Add-Type -AssemblyName UIAutomationTypes
   $root=[System.Windows.Automation.AutomationElement]::FromHandle($handle)
   $walker=[System.Windows.Automation.TreeWalker]::ControlViewWalker
   $queue=New-Object 'Collections.Generic.Queue[System.Windows.Automation.AutomationElement]';$queue.Enqueue($root);$result=New-Object Collections.Generic.List[object];$found=$null;$visited=0
   while($queue.Count -gt 0 -and $visited -lt 1200){$element=$queue.Dequeue();$visited++;try{$current=$element.Current;$ref=($element.GetRuntimeId() -join '.');if($data.elementRef -and $ref -eq $data.elementRef){$found=$element;break};if($data.action -eq 'snapshot' -and -not $current.IsOffscreen -and $result.Count -lt 400){$value=$null;if(-not $current.IsPassword){$pattern=$null;if($element.TryGetCurrentPattern([System.Windows.Automation.ValuePattern]::Pattern,[ref]$pattern)){$value=$pattern.Current.Value}};$r=$current.BoundingRectangle;$result.Add(@{ref=$ref;name=$current.Name;type=$current.ControlType.ProgrammaticName;automationId=$current.AutomationId;enabled=$current.IsEnabled;password=$current.IsPassword;value=$value;bounds=@{x=$r.X;y=$r.Y;width=$r.Width;height=$r.Height}})};$child=$walker.GetFirstChild($element);while($child){$queue.Enqueue($child);$child=$walker.GetNextSibling($child)}}catch{}}
   if($data.action -eq 'snapshot'){@{windowId=$data.windowId;elements=$result;limited=($visited -ge 1200)}|ConvertTo-Json -Depth 7 -Compress}
   else{if(-not $found){throw 'This element reference is stale. Read accessibility again.'};switch($data.action){'focus'{$found.SetFocus()}'invoke'{([System.Windows.Automation.InvokePattern]$found.GetCurrentPattern([System.Windows.Automation.InvokePattern]::Pattern)).Invoke()}'setValue'{if($found.Current.IsPassword){throw 'Use the account login credential-reference workflow for password fields'};([System.Windows.Automation.ValuePattern]$found.GetCurrentPattern([System.Windows.Automation.ValuePattern]::Pattern)).SetValue([string]$data.value)}'toggle'{([System.Windows.Automation.TogglePattern]$found.GetCurrentPattern([System.Windows.Automation.TogglePattern]::Pattern)).Toggle()}'select'{([System.Windows.Automation.SelectionItemPattern]$found.GetCurrentPattern([System.Windows.Automation.SelectionItemPattern]::Pattern)).Select()}default{throw 'Unknown accessibility action'}};' {"ok":true}'}
 }
 default {throw 'Unknown desktop operation'}
}
