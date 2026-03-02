let usb = null;
let usbMonitorStarted = false;

module.exports = {
  name: '桌面启动台',
  init: (api) => {
    console.log('Desktop Launcher plugin initialized');
    
    try {
      usb = require('usb');
    } catch (e) {
      console.warn('usb module not available, USB hotplug detection disabled:', e.message);
    }
  },
  functions: {
    getDiskList: async () => {
      try {
        const { execSync } = require('child_process');
        const disks = new Map();
        
        const getWmic = (cmd) => {
          try {
            return execSync(cmd, { encoding: 'utf8', timeout: 10000 });
          } catch { return ''; }
        };
        
        const removableOut = getWmic('wmic logicaldisk where "drivetype=2" get deviceid,volumename,size,freespace /format:csv');
        removableOut.split('\n').forEach(line => {
          const p = line.split(',');
          if (p[1]?.match(/^[A-Z]:$/)) {
            disks.set(p[1], { path: p[1], name: p[4]?.trim() || '可移动磁盘', free: parseInt(p[2]) || 0, size: parseInt(p[3]) || 0, isRemovable: true });
          }
        });

        const usbDrivesOut = getWmic('wmic path Win32_DiskDrive where "InterfaceType=\'USB\'" get Index /format:csv');
        const usbDriveIndexes = new Set();
        usbDrivesOut.split('\n').forEach(line => {
          const m = line.match(/(\d+)/);
          if (m) usbDriveIndexes.add(parseInt(m[1]));
        });

        if (usbDriveIndexes.size > 0) {
          const diskToPartitionOut = getWmic('wmic path Win32_DiskDriveToDiskPartition get Antecedent,Dependent /format:csv');
          const partitionToDisk = new Map();
          diskToPartitionOut.split('\n').forEach(line => {
            const antMatch = line.match(/Disk #(\d+)/);
            const depMatch = line.match(/Partition #(\d+)/);
            if (antMatch && depMatch) {
              partitionToDisk.set(parseInt(depMatch[1]), parseInt(antMatch[1]));
            }
          });

          const logicalToPartitionOut = getWmic('wmic path Win32_LogicalDiskToPartition get Antecedent,Dependent /format:csv');
          logicalToPartitionOut.split('\n').forEach(line => {
            const partMatch = line.match(/Partition #(\d+)/);
            const driveMatch = line.match(/([A-Z]:)/);
            if (partMatch && driveMatch) {
              const partNum = parseInt(partMatch[1]);
              const diskNum = partitionToDisk.get(partNum);
              if (diskNum !== undefined && usbDriveIndexes.has(diskNum) && !disks.has(driveMatch[1])) {
                const infoOut = getWmic(`wmic logicaldisk where "DeviceID='${driveMatch[1]}'" get VolumeName,Size,FreeSpace /format:csv`);
                infoOut.split('\n').forEach(il => {
                  const ip = il.split(',');
                  if (ip[1]?.trim() === driveMatch[1]) {
                    disks.set(driveMatch[1], { path: driveMatch[1], name: ip[4]?.trim() || '移动硬盘', free: parseInt(ip[2]) || 0, size: parseInt(ip[3]) || 0, isRemovable: true });
                  }
                });
              }
            }
          });
        }

        return { ok: true, disks: Array.from(disks.values()) };
      } catch (e) {
        console.error('getDiskList error:', e);
        return { ok: false, error: e.message };
      }
    },
    ejectDisk: async (drivePath) => {
        const { execSync } = require('child_process');
        return new Promise((resolve) => {
            try {
              const cmd = `(New-Object -comObject Shell.Application).Namespace(17).ParseName("${drivePath}").InvokeVerb("Eject")`;
              execSync(`powershell.exe -NoProfile -ExecutionPolicy Bypass -Command "${cmd}"`, {
                timeout: 10000
              });
              resolve({ ok: true });
            } catch (err) {
              resolve({ ok: false, error: err.message });
            }
        });
    },
    openSettings: () => {
      const { BrowserWindow } = require('electron');
      const path = require('path');
      
      if (global.desktopLauncherSettingsWin && !global.desktopLauncherSettingsWin.isDestroyed()) {
          global.desktopLauncherSettingsWin.show();
          global.desktopLauncherSettingsWin.focus();
          return { ok: true };
      }

      let win = new BrowserWindow({
        width: 860,
        height: 640,
        title: '启动台设置',
        webPreferences: {
          nodeIntegration: true,
          contextIsolation: false
        },
        autoHideMenuBar: true,
        backgroundColor: '#121212',
        frame: false,
        show: false
      });
      
      global.desktopLauncherSettingsWin = win;
      
      win.loadFile(path.join(__dirname, 'settings.html'));
      
      win.once('ready-to-show', () => {
          win.show();
      });

      win.on('closed', () => {
        win = null;
        global.desktopLauncherSettingsWin = null;
      });
      
      return { ok: true };
    },
    getFileIconDataUrl: async (p) => {
        try {
          const { app } = require('electron');
          const fp = String(p||''); if (!fp) return '';
          let usePath = fp;
          
          if (String(fp).toLowerCase().endsWith('.lnk')) {
            try {
              const { execSync } = require('child_process');
              const cmd = `wmic process where "name='explorer.exe'" call create "cmd /c echo %USERPROFILE%"`;
              const targetCmd = `(New-Object -COM WScript.Shell).CreateShortcut('${fp.replace(/'/g, "''")}').TargetPath`;
              const out = execSync(`powershell.exe -NoProfile -ExecutionPolicy Bypass -Command "${targetCmd}"`, { encoding: 'utf8', timeout: 5000 });
              if (out && out.trim()) usePath = out.trim();
            } catch (e) {}
          }
          
          const img = await app.getFileIcon(usePath, { size: 'large' });
          
          if (!img || img.isEmpty()) return '';
          return img.toDataURL();
        } catch (e) { return ''; }
    },
    startUsbMonitor: (callback) => {
      if (!usb) {
        return { ok: false, error: 'usb module not available' };
      }
      
      if (usbMonitorStarted) {
        return { ok: true, message: 'USB monitor already started' };
      }
      
      try {
        usb.on('attach', (device) => {
          console.log('USB device attached:', device);
          if (typeof callback === 'function') {
            callback({ type: 'attach', device });
          }
        });
        
        usb.on('detach', (device) => {
          console.log('USB device detached:', device);
          if (typeof callback === 'function') {
            callback({ type: 'detach', device });
          }
        });
        
        usbMonitorStarted = true;
        return { ok: true, message: 'USB monitor started' };
      } catch (e) {
        console.error('Failed to start USB monitor:', e);
        return { ok: false, error: e.message };
      }
    },
    stopUsbMonitor: () => {
      if (!usb) {
        return { ok: false, error: 'usb module not available' };
      }
      
      try {
        usb.removeAllListeners('attach');
        usb.removeAllListeners('detach');
        usbMonitorStarted = false;
        return { ok: true, message: 'USB monitor stopped' };
      } catch (e) {
        console.error('Failed to stop USB monitor:', e);
        return { ok: false, error: e.message };
      }
    },
    getUsbDeviceList: () => {
      if (!usb) {
        return { ok: false, error: 'usb module not available', devices: [] };
      }
      
      try {
        const { getDeviceList } = usb;
        const devices = getDeviceList();
        const deviceList = devices.map(d => ({
          busNumber: d.busNumber,
          deviceAddress: d.deviceAddress,
          vendorId: d.deviceDescriptor?.idVendor,
          productId: d.deviceDescriptor?.idProduct,
          manufacturer: d.deviceDescriptor?.iManufacturer,
          product: d.deviceDescriptor?.iProduct
        }));
        return { ok: true, devices: deviceList };
      } catch (e) {
        console.error('Failed to get USB device list:', e);
        return { ok: false, error: e.message, devices: [] };
      }
    }
  }
};
