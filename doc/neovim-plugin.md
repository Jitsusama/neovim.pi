# neovim-pi (neovim plugin)

The neovim half of the pi ↔ nvim companion protocol.
Ships with zero default wirings: no autocmds, no
commands, no keymaps. The user composes their own.

## Install

### lazy.nvim

```lua
{
  "Jitsusama/neovim.pi",
  config = function()
    require("neovim-pi").setup({
      -- Listen on the standard socket; override if needed.
      listen = vim.env.XDG_RUNTIME_DIR .. "/neovim-pi.sock",
      -- Enable pi:// buffer reads (opt-in).
      buffers = { enable = true },
      -- Enable :PiStatus / :PiDetach (opt-in).
      commands = { enable = true },
    })
  end,
}
```

### packer / paq

Point your plugin manager at the repo and the `nvim/`
subdirectory:

```lua
use { "Jitsusama/neovim.pi", rtp = "nvim" }
```

Or vendor `nvim/` into your config and add it to
`runtimepath`.

## Public API

Everything is under `require("neovim-pi")`:

| Function | Description |
|---|---|
| `setup(opts)` | Configure (idempotent). |
| `config()` | Return the active config. |
| `is_attached()` | True if pi is currently attached. |
| `call(method, args, callback)` | Async call into pi. |

Submodules:

| Module | Purpose |
|---|---|
| `neovim-pi.rpc` | Listener and channel management. |
| `neovim-pi.buffer` | `pi://` BufReadCmd adapter. |
| `neovim-pi.handshake` | Capability exchange. |
| `neovim-pi.commands` | Optional `:Pi*` user commands. |

## Composing your own keymaps

The plugin doesn't ship keymaps. Add them in your own
config under the `User NeovimPiBufferLoaded` autocmd
so they fire only on buffers we own:

```lua
vim.api.nvim_create_autocmd("User", {
  pattern = "NeovimPiBufferLoaded",
  callback = function(args)
    local buf = args.data.bufnr
    -- Endorse the focused finding (pi:// review buffers).
    vim.keymap.set("n", "<leader>e", function()
      require("neovim-pi").call("findings.act", { "endorse" })
    end, { buffer = buf, desc = "endorse finding" })
  end,
})
```

## Status fragments

When pi advertises `pi.status.subscribe`, the plugin
caches the composed status string. Pull it into your
statusline however you like:

```lua
require("lualine").setup({
  sections = {
    lualine_x = {
      function()
        local s = require("neovim-pi.handshake").peer() and "pi" or ""
        return s
      end,
    },
  },
})
```

## License

MIT. See [LICENSE](../LICENSE).
