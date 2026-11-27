using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace Stayra.Infrastructure.Persistence.Migrations
{
    /// <inheritdoc />
    public partial class ChannelConnections : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.CreateTable(
                name: "ChannelConnections",
                columns: table => new
                {
                    Id = table.Column<Guid>(type: "uuid", nullable: false),
                    TenantId = table.Column<Guid>(type: "uuid", nullable: false),
                    Channel = table.Column<string>(type: "character varying(32)", maxLength: 32, nullable: false),
                    AccountId = table.Column<string>(type: "text", nullable: false),
                    AccountName = table.Column<string>(type: "text", nullable: false),
                    IsEnabled = table.Column<bool>(type: "boolean", nullable: false),
                    CreatedAt = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_ChannelConnections", x => x.Id);
                });

            migrationBuilder.CreateIndex(
                name: "IX_ChannelConnections_Channel_AccountId",
                table: "ChannelConnections",
                columns: new[] { "Channel", "AccountId" });

            migrationBuilder.CreateIndex(
                name: "IX_ChannelConnections_TenantId_Channel_AccountId",
                table: "ChannelConnections",
                columns: new[] { "TenantId", "Channel", "AccountId" },
                unique: true);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropTable(
                name: "ChannelConnections");
        }
    }
}
