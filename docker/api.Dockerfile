# Build context: ./backend (see docker-compose.yml)
FROM mcr.microsoft.com/dotnet/sdk:10.0 AS build
WORKDIR /src
COPY Stayra.slnx ./
COPY src/Stayra.Domain/Stayra.Domain.csproj src/Stayra.Domain/
COPY src/Stayra.Application/Stayra.Application.csproj src/Stayra.Application/
COPY src/Stayra.Infrastructure/Stayra.Infrastructure.csproj src/Stayra.Infrastructure/
COPY src/Stayra.Api/Stayra.Api.csproj src/Stayra.Api/
RUN dotnet restore src/Stayra.Api/Stayra.Api.csproj
COPY src/ src/
RUN dotnet publish src/Stayra.Api/Stayra.Api.csproj -c Release -o /app --no-restore

# Debian-based runtime image: includes tzdata + ICU (needed for Asia/Ho_Chi_Minh and vi-VN formatting).
FROM mcr.microsoft.com/dotnet/aspnet:10.0 AS runtime
WORKDIR /app
# libgssapi: optional Kerberos support Npgsql probes for (silences a startup warning).
RUN apt-get update && apt-get install -y --no-install-recommends libgssapi-krb5-2 && rm -rf /var/lib/apt/lists/* \
    && mkdir -p /data/uploads && chown -R $APP_UID /data
COPY --from=build /app ./
ENV ASPNETCORE_URLS=http://+:8080 \
    Storage__Root=/data/uploads \
    DOTNET_SYSTEM_GLOBALIZATION_INVARIANT=false
EXPOSE 8080
USER $APP_UID
ENTRYPOINT ["dotnet", "Stayra.Api.dll"]
