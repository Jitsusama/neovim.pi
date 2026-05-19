-- RPC client and listener for the pi peer.
--
-- This file owns the socket: opening it, tracking the
-- pi channel id and dispatching calls from this side to
-- pi. The pi side uses `pi.dispatch` as the single
-- request method; we use the channel id stored after
-- handshake.

local M = {}

---@type integer?
local pi_chan = nil

---@type string?
local listen_path = nil

--- Start listening on a socket. Pi attaches to this path.
---@param path string
function M.listen(path)
  if listen_path == path then
    return
  end
  listen_path = path
  pcall(vim.fn.serverstop, listen_path)
  vim.fn.serverstart(listen_path)
end

--- Returns true if a pi peer has completed the handshake.
function M.is_attached()
  return pi_chan ~= nil
end

--- Mark the channel id of an attached pi peer.
---@param chan integer
function M.set_channel(chan)
  pi_chan = chan
end

--- Clear the channel id when pi detaches.
function M.clear_channel()
  pi_chan = nil
end

--- Call a method on the pi peer.
---@param method string
---@param args any[]
---@param callback fun(err: any, result: any)?
function M.call(method, args, callback)
  if not pi_chan then
    if callback then
      callback("pi is not attached", nil)
    end
    return
  end

  local payload = { method }
  for _, a in ipairs(args or {}) do
    payload[#payload + 1] = a
  end

  local ok, result = pcall(vim.rpcrequest, pi_chan, "pi.dispatch", unpack(payload))
  if callback then
    if ok then
      callback(nil, result)
    else
      callback(result, nil)
    end
  end
end

--- Fire-and-forget notify (no response).
function M.notify(method, args)
  if not pi_chan then
    return
  end
  local payload = { method }
  for _, a in ipairs(args or {}) do
    payload[#payload + 1] = a
  end
  pcall(vim.rpcnotify, pi_chan, "pi.dispatch", unpack(payload))
end

return M
