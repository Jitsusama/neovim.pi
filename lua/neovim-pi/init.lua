-- neovim-pi: public Lua API.
--
-- `require("neovim-pi").setup({ ... })` is the only
-- entry point the user calls. Everything else (RPC
-- client, buffer adapter, status cache) lives in
-- submodules and is opt-in.
--
-- Default config sets nothing up. The user (or another
-- plugin) opts into specific features:
--
--   require("neovim-pi").setup({
--     listen = "/run/user/1000/neovim-pi.sock",
--     buffers = { enable = true },
--     commands = { enable = true },
--   })

local M = {}

--- Default socket path: per-pid under the pi state dir.
local function default_socket()
  local base = vim.env.XDG_RUNTIME_DIR or vim.fn.expand("~/.local/state/pi")
  return base .. "/nvim-" .. vim.fn.getpid() .. ".sock"
end

---@class neovim_pi.Config
---@field listen string?         Socket path to listen on (or nil for none).
---@field buffers { enable: boolean }?  Register `pi://` BufReadCmd.
---@field commands { enable: boolean }? Register `:PiAttach`, `:PiStatus`, etc.

--- Default config. Every `setup()` call starts from this
--- and applies the user's opts on top, so omitting an
--- option always reverts it to the documented default.
local DEFAULTS = {
  listen = nil,
  buffers = { enable = false },
  commands = { enable = false },
}

---@type neovim_pi.Config
local config = vim.deepcopy(DEFAULTS)

--- Configure neovim-pi. Idempotent; safe to call multiple times.
---
--- The default `listen` path encodes the nvim PID so each
--- instance gets a unique socket. Pi discovers all live
--- sockets and pairs with whichever the user picks.
---
--- Each call replaces the previous configuration. Pass
--- everything you want enabled; anything you omit reverts
--- to its default.
---@param opts neovim_pi.Config?
function M.setup(opts)
  config = vim.tbl_deep_extend("force", DEFAULTS, opts or {})

  if config.listen == nil then
    config.listen = default_socket()
  end

  if config.listen then
    require("neovim-pi.rpc").listen(config.listen)
  end

  if config.buffers.enable then
    require("neovim-pi.buffer").enable()
  else
    require("neovim-pi.buffer").disable()
  end

  if config.commands.enable then
    require("neovim-pi.commands").enable()
  else
    require("neovim-pi.commands").disable()
  end
end

--- Return the current config (a copy).
function M.config()
  return vim.deepcopy(config)
end

--- Reset pi-owned editor state on detach.
---
--- nvim outlives a pi pairing, and so do these lua module
--- tables, so a reattach to the same nvim would otherwise
--- inherit the prior session's buffer claims and stage window
--- handles. Dropping the ownership ledger, forgetting the
--- stage windows (without closing them, so the human keeps
--- whatever they were shown) and stopping the cursor stream
--- makes the next pairing start clean. Idempotent.
function M.reset()
  require("neovim-pi.owned").clear()
  require("neovim-pi.stage").forget()
  require("neovim-pi.cursor").unwatch()
end

--- Returns true if a pi peer is currently attached.
function M.is_attached()
  return require("neovim-pi.rpc").is_attached()
end

--- Call a pi method by name. Async via a Lua callback.
---@param method string
---@param args any[]
---@param callback fun(err: any, result: any)
function M.call(method, args, callback)
  require("neovim-pi.rpc").call(method, args, callback)
end

return M
