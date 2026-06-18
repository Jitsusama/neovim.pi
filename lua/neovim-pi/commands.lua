-- Optional user-facing commands. Off by default.
--
-- Enable via `require("neovim-pi").setup({ commands = { enable = true } })`.
-- The user can also write their own commands against
-- the `neovim-pi` Lua API; this module is just a
-- convenience.

local M = {}

local function status()
  local handshake = require("neovim-pi.handshake")
  local rpc = require("neovim-pi.rpc")
  local peer = handshake.peer()
  if not rpc.is_attached() or not peer then
    vim.notify("neovim-pi: not attached", vim.log.levels.INFO)
    return
  end
  vim.notify(
    string.format("neovim-pi: pi attached (v%s, %d caps)", peer.version, #peer.capabilities),
    vim.log.levels.INFO
  )
end

local function detach()
  require("neovim-pi.rpc").clear_channel()
  -- Drop pi's ownership ledger and stage windows too, so an
  -- in-nvim detach leaves no stale claims for the next pairing.
  require("neovim-pi").reset()
  vim.notify("neovim-pi: detached", vim.log.levels.INFO)
end

local registered = false

--- Register `:PiStatus` and `:PiDetach`. Idempotent.
function M.enable()
  if registered then
    return
  end
  registered = true

  vim.api.nvim_create_user_command("PiStatus", status, { desc = "Show pi connection status." })
  vim.api.nvim_create_user_command("PiDetach", detach, { desc = "Drop the pi peer channel." })
end

--- Unregister both commands. Idempotent.
function M.disable()
  if not registered then
    return
  end
  registered = false
  pcall(vim.api.nvim_del_user_command, "PiStatus")
  pcall(vim.api.nvim_del_user_command, "PiDetach")
end

return M
