#!/usr/bin/env python3
"""Discover and list all available instruments, ports, and addresses."""

import sys
import platform


def header(title):
    print(f"\n{'=' * 60}")
    print(f"  {title}")
    print(f"{'=' * 60}")


def section(title):
    print(f"\n--- {title} ---")


def list_visa_resources():
    """List all VISA resources (GPIB, USB-TMC, LAN/LXI instruments)."""
    header("VISA Resources  (PyVISA)")
    try:
        import pyvisa
    except ImportError:
        print("  pyvisa not installed – skipping")
        return

    backends = []
    # Try NI-VISA first, then pyvisa-py fallback
    for backend in ("", "@py"):
        label = "NI-VISA" if backend == "" else "pyvisa-py"
        try:
            rm = pyvisa.ResourceManager(backend)
            backends.append((label, backend, rm))
        except Exception:
            pass

    if not backends:
        print("  No VISA backend available (install NI-VISA or pyvisa-py)")
        return

    for label, _, rm in backends:
        section(f"Backend: {label}")
        try:
            resources = rm.list_resources()
        except Exception as e:
            print(f"  Error listing resources: {e}")
            continue

        if not resources:
            print("  (no resources found)")
            continue

        for addr in sorted(resources):
            line = f"  {addr}"
            # Try to identify the instrument
            try:
                inst = rm.open_resource(addr, open_timeout=2000)
                inst.timeout = 3000
                idn = inst.query("*IDN?").strip()
                inst.close()
                line += f"\n    IDN: {idn}"
            except Exception:
                pass
            print(line)


def list_serial_ports():
    """List all serial / COM ports."""
    header("Serial Ports")
    try:
        from serial.tools.list_ports import comports
    except ImportError:
        print("  pyserial not installed – skipping")
        return

    ports = sorted(comports(), key=lambda p: p.device)
    if not ports:
        print("  (no serial ports found)")
        return

    for p in ports:
        print(f"  {p.device}")
        if p.description and p.description != "n/a":
            print(f"    Description : {p.description}")
        if p.manufacturer:
            print(f"    Manufacturer: {p.manufacturer}")
        if p.serial_number:
            print(f"    Serial #    : {p.serial_number}")
        if p.vid is not None:
            print(f"    VID:PID     : {p.vid:04X}:{p.pid:04X}")
        if p.hwid and p.hwid != "n/a":
            print(f"    HWID        : {p.hwid}")


def list_nidaqmx_devices():
    """List NI-DAQmx devices and their channels."""
    header("NI-DAQmx Devices")
    try:
        import nidaqmx
        import nidaqmx.system
    except ImportError:
        print("  nidaqmx not installed – skipping")
        return

    try:
        system = nidaqmx.system.System.local()
    except Exception as e:
        print(f"  Error accessing NI-DAQmx system: {e}")
        return

    devices = list(system.devices)
    if not devices:
        print("  (no NI-DAQmx devices found)")
        return

    for dev in devices:
        print(f"  {dev.name}  –  {dev.product_type}")
        if dev.ai_physical_chans:
            chans = [str(c.name) for c in dev.ai_physical_chans]
            print(f"    AI channels : {', '.join(chans)}")
        if dev.ao_physical_chans:
            chans = [str(c.name) for c in dev.ao_physical_chans]
            print(f"    AO channels : {', '.join(chans)}")
        if dev.di_lines:
            lines = [str(l.name) for l in dev.di_lines]
            print(f"    DI lines    : {', '.join(lines)}")
        if dev.do_lines:
            lines = [str(l.name) for l in dev.do_lines]
            print(f"    DO lines    : {', '.join(lines)}")
        if dev.ci_physical_chans:
            chans = [str(c.name) for c in dev.ci_physical_chans]
            print(f"    CI channels : {', '.join(chans)}")


def list_network_lxi():
    """Attempt mDNS/Zeroconf discovery of LXI instruments on the network."""
    header("LXI Network Instruments  (mDNS/Zeroconf)")
    try:
        from zeroconf import Zeroconf, ServiceBrowser
    except ImportError:
        print("  zeroconf not installed – skipping  (pip install zeroconf)")
        return

    import time

    class Listener:
        def __init__(self):
            self.found = []

        def add_service(self, zc, stype, name):
            info = zc.get_service_info(stype, name)
            if info:
                from ipaddress import ip_address
                addrs = [str(ip_address(a)) for a in info.addresses]
                self.found.append((name, addrs, info.port, info.properties))

        def remove_service(self, *a):
            pass

        def update_service(self, *a):
            pass

    zc = Zeroconf()
    listener = Listener()
    # LXI instruments typically advertise as _lxi._tcp.local. or _vxi-11._tcp.local.
    for stype in ["_lxi._tcp.local.", "_vxi-11._tcp.local.", "_scpi-raw._tcp.local."]:
        ServiceBrowser(zc, stype, listener)

    print("  Scanning for 3 seconds ...")
    time.sleep(3)
    zc.close()

    if not listener.found:
        print("  (no LXI instruments found on network)")
        return

    for name, addrs, port, props in listener.found:
        print(f"  {name}")
        print(f"    Addresses: {', '.join(addrs)}  port {port}")
        for k, v in props.items():
            try:
                print(f"    {k.decode()}: {v.decode()}")
            except Exception:
                pass


def list_usb_devices():
    """List USB devices (helpful for identifying connected instruments)."""
    header("USB Devices")
    if platform.system() == "Darwin":
        import subprocess
        try:
            out = subprocess.check_output(
                ["system_profiler", "SPUSBDataType", "-detailLevel", "mini"],
                text=True, timeout=10,
            )
            # Print a condensed version – indented items with names and vendor/product IDs
            for line in out.splitlines():
                stripped = line.strip()
                if not stripped:
                    continue
                # Lines with a colon at the end are device names
                if stripped.endswith(":") and not stripped.startswith("USB"):
                    print(f"  {stripped}")
                elif any(
                    stripped.startswith(k)
                    for k in ("Product ID:", "Vendor ID:", "Serial Number:", "Location ID:", "Manufacturer:")
                ):
                    print(f"      {stripped}")
        except Exception as e:
            print(f"  Error: {e}")
    elif platform.system() == "Linux":
        import subprocess
        try:
            out = subprocess.check_output(["lsusb"], text=True, timeout=10)
            for line in out.strip().splitlines():
                print(f"  {line}")
        except FileNotFoundError:
            print("  lsusb not available")
    else:
        print("  USB listing not implemented for this platform")


def list_driver_registry():
    """Show which drivers are available in the sensor_app registry."""
    header("Sensor App Driver Registry")
    try:
        from driver_base import DRIVER_REGISTRY
    except ImportError:
        # Try adjusting path
        import os
        sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
        try:
            from driver_base import DRIVER_REGISTRY
        except ImportError:
            print("  Could not import driver_base")
            return

    for name, cls in sorted(DRIVER_REGISTRY.items()):
        print(f"  {name:20s}  →  {cls.__module__}.{cls.__name__}")

    section("Missing drivers (import failed)")
    expected = {"simulated", "sim_pump", "ni_cdaq", "yokogawa_wt", "alicat", "rigol_dho"}
    missing = expected - set(DRIVER_REGISTRY.keys())
    if missing:
        for m in sorted(missing):
            print(f"  {m}")
    else:
        print("  (none – all drivers available)")


def main():
    print("Instrument & Port Discovery")
    print(f"Python {sys.version}")
    print(f"Platform: {platform.platform()}")

    list_driver_registry()
    list_visa_resources()
    list_serial_ports()
    list_nidaqmx_devices()
    list_usb_devices()
    list_network_lxi()

    print()


if __name__ == "__main__":
    main()
