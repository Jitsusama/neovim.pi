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

--- Path to the cwd sidecar file for a given socket. Pi's
--- discovery reads this so the multi-nvim picker can show
--- the user which project each nvim is in.
local function sidecar_path(socket)
  return (socket:gsub("%.sock$", ".cwd"))
end

--- Write the current working directory next to the socket
--- so pi's picker can show project context.
local function write_sidecar(socket)
  local path = sidecar_path(socket)
  local f = io.open(path, "w")
  if not f then
    return
  end
  f:write(vim.fn.getcwd())
  f:close()
end

--- Start listening on a socket. Pi attaches to this path.
--- Creates the parent directory and removes a stale
--- socket file if one exists (e.g. from a previous nvim
--- that crashed without cleaning up).
---@param path string
function M.listen(path)
  if listen_path == path then
    return
  end
  listen_path = path

  -- Ensure the parent directory exists.
  local dir = vim.fs.dirname(path)
  if dir and dir ~= "" then
    vim.fn.mkdir(dir, "p")
  end

  -- If a stale socket file exists, remove it. `serverstart`
  -- on an existing path silently picks a new one with a
  -- suffix, which pi would never find.
  if vim.uv.fs_stat(path) then
    pcall(vim.fn.serverstop, path)
    pcall(os.remove, path)
  end

  vim.fn.serverstart(path)
  write_sidecar(path)

  -- Keep the cwd sidecar in step if the user changes
  -- directory; pi's picker should reflect the live state.
  vim.api.nvim_create_autocmd("DirChanged", {
    pattern = "global",
    callback = function()
      write_sidecar(path)
    end,
  })

  -- Remove the socket file (and its cwd sidecar) when nvim
  -- exits so the next pi session doesn't see a stale
  -- candidate.
  vim.api.nvim_create_autocmd("VimLeavePre", {
    once = true,
    callback = function()
      pcall(vim.fn.serverstop, path)
      pcall(os.remove, path)
      pcall(os.remove, sidecar_path(path))
    end,
  })
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
