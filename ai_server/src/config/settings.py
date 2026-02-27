"""
Configuration management using Pydantic Settings
"""
from pydantic_settings import BaseSettings
from pydantic import Field
from typing import Optional


class Settings(BaseSettings):
    """Application settings from environment variables"""
    
    # Google AI
    google_api_key: str = Field(..., alias="GOOGLE_API_KEY")
    llm_model: str = Field(default="gemini-2.5-flash", alias="LLM_MODEL")
    
    # Server Configuration
    host: str = Field(default="127.0.0.1", alias="HOST")
    port: int = Field(default=8000, alias="PORT")
    
    # Environment
    environment: str = Field(default="development", alias="ENVIRONMENT")
    
    # Logging
    log_level: str = Field(default="INFO", alias="LOG_LEVEL")
    
    # Cache Configuration
    cache_enabled: bool = Field(default=True, alias="CACHE_ENABLED")
    cache_ttl_seconds: int = Field(default=86400, alias="CACHE_TTL_SECONDS")  # 24 hours
    
    # Rate Limiting
    rate_limit_enabled: bool = Field(default=True, alias="RATE_LIMIT_ENABLED")
    rate_limit_times: int = Field(default=10, alias="RATE_LIMIT_TIMES")
    rate_limit_seconds: int = Field(default=60, alias="RATE_LIMIT_SECONDS")
    
    # Ephemeris Configuration (Swiss Ephemeris)
    ephemeris_path: str = Field(default="./ephe", alias="EPHEMERIS_PATH")
    ayanamsa: str = Field(default="LAHIRI", alias="AYANAMSA")

    
    class Config:
        env_file = ".env"
        env_file_encoding = "utf-8"
        case_sensitive = False


# Global settings instance
settings = Settings()
