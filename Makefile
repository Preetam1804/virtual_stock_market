# Builds the original C terminal client.
#
# The client is cross-platform (Windows, macOS, Linux) and reads/writes the
# same data files as the web app, so run it from the repository root:
#
#   make && ./virtual_stock_market
#
# On Windows, use `gcc virtual_stock_market.c -o virtual_stock_market.exe`.

CC      ?= cc
CFLAGS  ?= -std=c11 -Wall -Wextra -O2
TARGET   = virtual_stock_market
SRC      = virtual_stock_market.c

.PHONY: all run clean

all: $(TARGET)

$(TARGET): $(SRC)
	$(CC) $(CFLAGS) -o $@ $(SRC)

run: $(TARGET)
	./$(TARGET)

clean:
	rm -f $(TARGET)
