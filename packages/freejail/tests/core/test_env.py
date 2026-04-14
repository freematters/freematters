from freejail.core.env import capture_env_vars

PREFIXES = ["ANTHROPIC_", "CLAUDE_CODE_"]


def test_captures_anthropic_vars():
    env = {
        "ANTHROPIC_API_KEY": "sk-abc",
        "ANTHROPIC_MODEL": "claude-opus-4-6",
        "HOME": "/home/user",
        "PATH": "/usr/bin",
    }
    result = capture_env_vars(env, PREFIXES)
    assert result == {
        "ANTHROPIC_API_KEY": "sk-abc",
        "ANTHROPIC_MODEL": "claude-opus-4-6",
    }


def test_captures_claude_code_vars():
    env = {
        "CLAUDE_CODE_MAX_TOKENS": "4096",
        "CLAUDE_API_KEY": "should-not-match",
    }
    result = capture_env_vars(env, PREFIXES)
    assert result == {"CLAUDE_CODE_MAX_TOKENS": "4096"}


def test_captures_both_prefixes():
    env = {
        "ANTHROPIC_API_KEY": "sk-abc",
        "CLAUDE_CODE_SETTING": "val",
        "OTHER": "ignored",
    }
    result = capture_env_vars(env, PREFIXES)
    assert len(result) == 2


def test_empty_env():
    assert capture_env_vars({}, PREFIXES) == {}


def test_custom_prefixes():
    env = {"CUSTOM_FOO": "bar", "ANTHROPIC_KEY": "val"}
    result = capture_env_vars(env, ["CUSTOM_"])
    assert result == {"CUSTOM_FOO": "bar"}
