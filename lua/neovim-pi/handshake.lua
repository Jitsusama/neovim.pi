-- Handshake: the first RPC exchange after pi attaches.
--
-- Pi calls `nvim_exec_lua` with this module's `exchange`
-- function, passing pi's version and capability list.
-- We record the pi channel and return our own.

local M = {}

-- Wire protocol version this plugin speaks.
local PROTOCOL_VERSION = "0.1.0"

-- Capabilities this plugin advertises.
local NVIM_CAPABILITIES = {
  "nvim.buffer.open",
  "nvim.buffer.close",
  "nvim.buffer.markStale",
  "nvim.buffer.isModified",
  "nvim.buffer.reload",
  "nvim.window.cursor.set",
  "nvim.extmark.set",
  "nvim.status.publish",
}

---@type { version: string, capabilities: string[] }?
local pi_peer = nil

--- Exchange capability info with pi. Called by pi via nvim_exec_lua.
---@param pi_version string
---@param pi_caps string[]
---@return { version: string, capabilities: string[] }
function M.exchange(pi_version, pi_caps)
  pi_peer = { version = pi_version, capabilities = pi_caps or {} }

  -- The channel id of the caller is the pi process. We can't
  -- query it inside nvim_exec_lua directly; the dispatcher
  -- captures it via `vim.rpcrequest` source on the request
  -- event. For now we record peer info and expect the user's
  -- bootstrap or pi's first follow-up call to set the channel
  -- via `neovim-pi.rpc.set_channel`.

  return {
    version = PROTOCOL_VERSION,
    capabilities = NVIM_CAPABILITIES,
  }
end

--- Inspect the recorded pi peer info.
function M.peer()
  return pi_peer and vim.deepcopy(pi_peer) or nil
end

--- Returns true when the pi peer advertised a capability.
---@param flag string
function M.pi_has(flag)
  if not pi_peer then
    return false
  end
  for _, c in ipairs(pi_peer.capabilities) do
    if c == flag then
      return true
    end
  end
  return false
end

return M
