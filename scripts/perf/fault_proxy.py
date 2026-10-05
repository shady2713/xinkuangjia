"""在隔离环境插入固定延迟的转发代理，仅用于性能门禁的负对照证据。

它不修改被测代码，也不属于交付物：只在本地环回地址上监听，把请求原样转发到真实服务，
并在转发响应前插入固定毫秒延迟。用它复现“确实变慢”的场景，验证超过预算时判定会失败，
而不是只验证把阈值调紧会失败。禁止在任何交付、联调或生产环境使用本脚本。

@author 李杰
"""

from __future__ import annotations

import argparse
import http.client
import socketserver
import sys
import time
from typing import Sequence

HOP_BY_HOP = {"connection", "keep-alive", "proxy-authenticate", "proxy-authorization",
              "te", "trailer", "transfer-encoding", "upgrade"}


class DelayHandler(socketserver.BaseRequestHandler):
    """按请求转发到上游并插入固定延迟；不解析业务语义，只按字节转发。"""

    def handle(self) -> None:
        """读取一次完整请求、转发、延迟后写回响应，然后关闭本次连接。"""

        payload = self._read_request()
        if payload is None:
            return
        head, body = payload
        lines = head.split(b"\r\n")
        method, path, _ = lines[0].decode("latin-1").split(" ", 2)
        headers = {}
        for line in lines[1:]:
            if b":" not in line:
                continue
            name, _, value = line.partition(b":")
            headers[name.decode("latin-1")] = value.strip().decode("latin-1")
        headers.pop("Host", None)
        try:
            upstream = http.client.HTTPConnection(self.server.upstream_host,  # type: ignore[attr-defined]
                                                  self.server.upstream_port, timeout=60)  # type: ignore[attr-defined]
            upstream.request(method, path, body=body, headers=headers)
            response = upstream.getresponse()
            content = response.read()
        except (OSError, http.client.HTTPException):
            self.request.sendall(b"HTTP/1.1 502 Bad Gateway\r\nContent-Length: 0\r\nConnection: close\r\n\r\n")
            return
        # 延迟只加在响应路径上，模拟服务端处理变慢，同时不改动任何请求内容。
        time.sleep(self.server.delay_seconds)  # type: ignore[attr-defined]
        head_out = [f"HTTP/1.1 {response.status} {response.reason}"]
        for name, value in response.getheaders():
            if name.lower() in HOP_BY_HOP or name.lower() == "content-length":
                continue
            head_out.append(f"{name}: {value}")
        head_out.append(f"Content-Length: {len(content)}")
        head_out.append("Connection: close")
        self.request.sendall(("\r\n".join(head_out) + "\r\n\r\n").encode("latin-1") + content)

    def _read_request(self) -> tuple[bytes, bytes] | None:
        """读取请求头与按 Content-Length 指定的正文，返回头部与正文。

        Returns:
            (头部字节, 正文字节)；读取不完整时返回 None。
        """

        buffer = b""
        while b"\r\n\r\n" not in buffer:
            chunk = self.request.recv(65536)
            if not chunk:
                return None
            buffer += chunk
        head, _, rest = buffer.partition(b"\r\n\r\n")
        length = 0
        for line in head.split(b"\r\n")[1:]:
            name, _, value = line.partition(b":")
            if name.strip().lower() == b"content-length":
                try:
                    length = int(value.strip())
                except ValueError:
                    length = 0
        body = rest
        while len(body) < length:
            chunk = self.request.recv(min(65536, length - len(body)))
            if not chunk:
                break
            body += chunk
        return head, body


class Server(socketserver.ThreadingTCPServer):
    """保存上游地址与延迟参数的多线程转发服务。"""

    allow_reuse_address = True
    daemon_threads = True


def main(argv: Sequence[str] | None = None) -> int:
    """启动转发代理并阻塞运行，直到收到中断。

    Args:
        argv: 命令行参数；省略时读取真实进程参数。
    Returns:
        0 表示正常结束；2 表示参数不可用。
    """

    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--listen-port", type=int, default=48091)
    parser.add_argument("--upstream-host", default="127.0.0.1")
    parser.add_argument("--upstream-port", type=int, default=48090)
    parser.add_argument("--delay-ms", type=int, required=True)
    args = parser.parse_args(argv)
    if args.delay_ms < 0 or not 0 < args.listen_port < 65536:
        print("延迟必须非负，监听端口必须有效", file=sys.stderr)
        return 2
    server = Server(("127.0.0.1", args.listen_port), DelayHandler)
    server.upstream_host = args.upstream_host  # type: ignore[attr-defined]
    server.upstream_port = args.upstream_port  # type: ignore[attr-defined]
    server.delay_seconds = args.delay_ms / 1000  # type: ignore[attr-defined]
    print(f"负对照代理已监听 127.0.0.1:{args.listen_port} → "
          f"{args.upstream_host}:{args.upstream_port}，每响应增加 {args.delay_ms} ms", flush=True)
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        server.server_close()
    return 0


if __name__ == "__main__":
    sys.exit(main())
